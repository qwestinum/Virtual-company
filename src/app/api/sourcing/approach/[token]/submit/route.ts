/**
 * POST /api/sourcing/approach/[token]/submit — la personne approchée envoie sa
 * candidature. PUBLIQUE : l'authentification est le jeton de l'URL.
 * Spec : docs/specs/sourcing.md §9-10.
 *
 * Ordre : débit (fail-closed, avant de lire le corps) → état du lien (le même
 * résolveur que la page) → validation → CV joint stocké → réservation
 * conditionnelle → réponse « bien reçue ».
 *
 * L'ADMISSION (analyse, CV structuré, invitation) ne tourne PLUS ici : elle
 * part sur le rail de reprise (`runSourcingMaintenance`) dès que la
 * réservation et la saisie sont durablement en base. La personne n'attend plus
 * une analyse complète (LLM, extraction, PDF, mail) derrière son clic — la
 * réponse arrive en quelques allers-retours, l'invitation au tick suivant
 * (diagnostic de latence du 14/09/2026). Le rail étant désormais le SEUL à
 * admettre, il n'y a plus de route à attendre (cf. `FIRST_ATTEMPT_GRACE_MINUTES`).
 */
import { NextResponse } from 'next/server';

import { reserveSubmission, type StoredSubmission } from '@/lib/db/repos/sourcing-admission';
import { isSupportedCvAttachment } from '@/lib/imap/cv-attachment';
import { clientIp, consumeQuota } from '@/lib/jobboard/rate-limit';
import { MAX_CV_BYTES } from '@/lib/jobboard/application-mail';
import { SubmissionSchema } from '@/lib/sourcing/landing';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';
import { deleteArtifact, uploadArtifactBinary } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const maxDuration = 60;

const fail = (status: number, error: string, message: string, headers?: Record<string, string>) =>
  NextResponse.json({ error, message }, { status, headers });

const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? '';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const quota = await consumeQuota({ key: `sourcing:submit:${clientIp(request) ?? 'unknown'}`, limit: 5, windowSeconds: 600 });
  if (!quota.allowed) {
    return fail(429, 'rate_limited', 'Trop de tentatives. Merci de réessayer dans quelques minutes.', { 'Retry-After': String(quota.retryAfterSeconds) });
  }

  const { token } = await params;
  const context = await resolveLandingContext(token);
  if (context.state.kind !== 'form' || !context.approach) {
    return NextResponse.json({ outcome: context.state.kind === 'received' ? 'received' : context.state.kind });
  }
  const approach = context.approach;

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, 'invalid_body', 'Le formulaire n’a pas pu être lu.');
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('submission') ?? ''));
  } catch {
    return fail(400, 'invalid_body', 'Le formulaire n’a pas pu être lu.');
  }
  const parsed = SubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message =
      field === 'email' ? 'Cette adresse email ne semble pas valide.'
      : field === 'consent' ? 'Merci de cocher la case pour confirmer vos informations.'
      : field === 'phone' ? 'Ce numéro de téléphone ne semble pas valide.'
      : field === 'fullName' ? 'Merci d’indiquer votre nom complet.'
      : 'Une information du formulaire n’est pas valide.';
    return fail(400, 'invalid_submission', message);
  }

  let cv: StoredSubmission['cv'] = null;
  const file = form.get('cv');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CV_BYTES) return fail(400, 'cv_too_large', 'Le CV dépasse 10 Mo.');
    if (!isSupportedCvAttachment(file.type, file.name)) return fail(400, 'cv_format', 'Le CV doit être un PDF ou un DOCX.');
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'cv';
    try {
      const up = await uploadArtifactBinary({
        owner: { kind: 'campaign', id: approach.campaignId },
        name: `sourcing-cvfile-${approach.id}-${safeName}`,
        content: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || (safeName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      });
      cv = { bucket: up.bucket, storagePath: up.path, fileName: file.name.slice(0, 200), mime: file.type || 'application/octet-stream' };
    } catch {
      return fail(502, 'cv_upload_failed', 'Votre CV n’a pas pu être enregistré. Vous pouvez réessayer, ou envoyer sans CV.');
    }
  }

  const won = await reserveSubmission(approach.id, { ...parsed.data, cv }).catch(() => false);
  if (!won && cv) await deleteArtifact(cv.storagePath).catch(() => {});
  // Gagnée : réservation + saisie sont en base, le rail admet au prochain
  // passage. Perdue : un envoi précédent l'a déjà faite. Dans les deux cas la
  // candidature est entre de bonnes mains — une seule réponse.
  return NextResponse.json({ outcome: 'received', firstName: firstName(parsed.data.fullName) });
}
