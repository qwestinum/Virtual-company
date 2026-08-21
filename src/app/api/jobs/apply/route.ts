/**
 * POST /api/jobs/apply — dépôt d'une candidature depuis le jobboard fictif.
 *
 * Cette route N'INJECTE RIEN dans le pipeline : elle compose un vrai mail de
 * candidature et l'ENVOIE à la boîte associée à la campagne. La relève IMAP le
 * ramasse, le rapproche par l'identifiant en objet, analyse le CV et déroule la
 * suite. La démonstration emprunte donc le chemin de production à l'identique —
 * c'est précisément ce qui la rend probante, et ça vaut la minute d'attente.
 *
 * Surface publique : l'appelant n'a pas de compte. Trois gardes tiennent la
 * porte, dans cet ordre :
 *   1. le flag `DEMO_JOBBOARD_ENABLED` (fail-closed, 404 — la surface n'existe
 *      simplement pas ailleurs) ;
 *   2. le débit par adresse, AVANT de lire le corps multipart : une rafale ne
 *      doit pas nous coûter le décodage de pièces jointes de 10 Mo ;
 *   3. la validation du formulaire et du fichier.
 *
 * L'annonce doit être PUBLIÉE pour qu'une candidature soit acceptée : sans
 * cette vérification, une campagne dépubliée resterait ouverte aux dépôts pour
 * qui connaîtrait son identifiant.
 */
import { NextResponse } from 'next/server';

import { getCampaign } from '@/lib/db/repos/campaigns';
import { getVisibleJobPost } from '@/lib/db/repos/demo-job-posts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { sendEmail } from '@/lib/email/client';
import {
  buildApplicationHtml,
  buildApplicationSubject,
  validateApplication,
} from '@/lib/jobboard/application-mail';
import { isDemoJobboardEnabled } from '@/lib/jobboard/flag';
import { clientIp, consumeApplyQuota } from '@/lib/jobboard/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDemoJobboardEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const quota = await consumeApplyQuota(clientIp(request));
  if (!quota.allowed) {
    const res = fail(
      429,
      'rate_limited',
      'Trop de candidatures envoyées depuis cet appareil. Merci de réessayer dans quelques minutes.',
    );
    res.headers.set('Retry-After', String(quota.retryAfterSeconds));
    return res;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'invalid_request', 'Formulaire illisible.');
  }

  const campaignId = String(form.get('campaignId') ?? '').trim();
  const cv = form.get('cv');
  if (!campaignId || !(cv instanceof File)) {
    return fail(400, 'invalid_request', 'Candidature incomplète.');
  }

  const validation = validateApplication({
    fullName: String(form.get('fullName') ?? ''),
    email: String(form.get('email') ?? ''),
    phone: form.get('phone') != null ? String(form.get('phone')) : null,
    fileName: cv.name,
    mime: cv.type,
    size: cv.size,
  });
  if (!validation.ok) {
    return fail(422, validation.code, validation.message);
  }
  const { fullName, email, phone } = validation.value;

  try {
    // L'annonce publiée est la seule porte d'entrée légitime.
    const post = await getVisibleJobPost(campaignId);
    if (!post) {
      return fail(404, 'offer_not_found', 'Cette offre n’est plus disponible.');
    }

    const campaign = await getCampaign(campaignId);
    const settings = await getAppSettings().catch(() => null);
    const recipient = await resolveCampaignReceptionAddress(
      campaignId,
      settings?.intakeEmail,
    );
    if (!recipient) {
      // Aucune boîte associée, aucun réglage d'intake : le mail n'irait nulle
      // part. On le DIT plutôt que de rendre un faux succès au candidat —
      // c'est exactement le cas qu'une démonstration doit voir arriver avant
      // le rendez-vous, pas pendant.
      await appendJournalEntry({
        action: 'demo_jobboard_application_failed',
        actor: 'demo_jobboard',
        campaignId,
        payload: { reason: 'no_reception_address', email, fileName: cv.name },
      }).catch(() => {});
      return fail(
        503,
        'no_reception_address',
        'Cette offre ne peut pas recevoir de candidature pour le moment.',
      );
    }

    const jobTitle = post.title;
    const subject = buildApplicationSubject({ campaignId, jobTitle });
    const buffer = Buffer.from(await cv.arrayBuffer());

    const result = await sendEmail({
      to: recipient,
      subject,
      html: buildApplicationHtml({ campaignId, jobTitle, fullName, email, phone }),
      // Répondre au candidat depuis la boîte de réception doit fonctionner :
      // l'expéditeur technique est l'adresse d'envoi de l'instance, pas la
      // sienne.
      replyTo: email,
      attachments: [
        {
          filename: cv.name,
          content: buffer.toString('base64'),
          // Sans type explicite, le CV arrive en pièce jointe générique et la
          // porte MIME du poller (`isSupportedCvAttachment`) ne tient plus qu'à
          // l'extension du nom de fichier.
          contentType: cv.type || 'application/octet-stream',
        },
      ],
    });

    if (!result.ok) {
      await appendJournalEntry({
        action: 'demo_jobboard_application_failed',
        actor: 'demo_jobboard',
        campaignId,
        payload: { reason: result.error ?? 'send_failed', email, fileName: cv.name },
      }).catch(() => {});
      return fail(
        502,
        'send_failed',
        'L’envoi de votre candidature a échoué. Merci de réessayer.',
      );
    }

    await appendJournalEntry({
      action: 'demo_jobboard_application_sent',
      actor: 'demo_jobboard',
      campaignId,
      payload: {
        candidate: fullName,
        email,
        phone,
        fileName: cv.name,
        subject,
        recipient,
        messageId: result.messageId,
        // La campagne doit être `active` ET porter une fiche validée pour que
        // la relève traite le mail : on trace l'état AU MOMENT du dépôt, sinon
        // un « CV jamais arrivé » se diagnostique à l'aveugle.
        campaignStatus: campaign?.status ?? null,
        scoringSheetValidated: campaign?.scoringSheet?.isValidated ?? false,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return fail(503, 'supabase_not_configured', 'Service indisponible.');
    }
    return fail(
      500,
      'unexpected_error',
      'Une erreur est survenue. Merci de réessayer.',
    );
  }
}
