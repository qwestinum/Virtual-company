/**
 * POST /api/sourcing/approach/[token]/submit — la personne approchée envoie sa
 * candidature. PUBLIQUE : l'authentification est le jeton de l'URL.
 * Spec : docs/specs/sourcing.md §9-10.
 *
 * Ordre : débit (fail-closed, avant de lire le corps) → état du lien (le même
 * résolveur que la page) → validation → CV joint stocké → réservation
 * conditionnelle → admission. Une panne d'analyse rend « bien reçue » : la
 * saisie est conservée et le rail reprend.
 */
import { NextResponse } from 'next/server';

import { reserveSubmission, type StoredSubmission } from '@/lib/db/repos/sourcing-admission';
import { isSupportedCvAttachment } from '@/lib/imap/cv-attachment';
import { clientIp, consumeQuota } from '@/lib/jobboard/rate-limit';
import { MAX_CV_BYTES } from '@/lib/jobboard/application-mail';
import { SubmissionSchema } from '@/lib/sourcing/landing';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';
import { deleteArtifact, uploadArtifactBinary } from '@/lib/storage/blob';
import { getLandingApproach } from '@/lib/db/repos/sourcing-admission';

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
  if (!won) {
    if (cv) await deleteArtifact(cv.storagePath).catch(() => {});
    return NextResponse.json({ outcome: 'received', firstName: firstName(parsed.data.fullName) });
  }

  const reserved = await getLandingApproach(approach.id).catch(() => null);
  const outcome = reserved ? await admitSourcedCandidate(reserved) : { kind: 'deferred' as const, cause: 'reload_failed' };
  if (outcome.kind === 'closed') return NextResponse.json({ outcome: 'closed' });
  return NextResponse.json({
    outcome: outcome.kind === 'admitted' ? 'sent' : 'received',
    firstName: firstName(parsed.data.fullName),
    recruiterName: outcome.kind === 'admitted' ? outcome.recruiterName : null,
  });
}
