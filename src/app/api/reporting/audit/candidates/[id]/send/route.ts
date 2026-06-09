/**
 * /api/reporting/audit/candidates/[id]/send — envoie le PDF d'audit
 * candidat par email (cf. docs/specs/reporting.md §5.2, §5.3).
 *
 * Si le PDF n'a pas été généré au préalable, il l'est automatiquement
 * avant l'envoi. Chaque envoi est consigné au journal (traçabilité RGPD :
 * date, destinataires, sujet, message-id).
 */
import { NextResponse } from 'next/server';

import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import { auditCandidatFileName } from '@/lib/reporting/audit-display';
import { renderCandidateAuditPdf } from '@/lib/reporting/candidate-audit-pdf';
import { deriveJourneyFor } from '@/lib/reporting/candidate-journey';
import { loadCandidateMarkers } from '@/lib/reporting/journey-lookup';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Sépare une saisie « a@x.fr, b@y.fr ; c@z.fr » en adresses propres. */
function parseRecipients(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  let body: { to?: unknown; subject?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Corps JSON invalide.' },
      { status: 400 },
    );
  }

  const recipients = parseRecipients(body.to);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Au moins un destinataire est requis.' },
      { status: 400 },
    );
  }

  try {
    const detail = await getCandidateAnalysis(id);
    if (!detail) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const markers = await loadCandidateMarkers({
      campaignId: detail.campaignId ?? undefined,
    });
    const journey = deriveJourneyFor(detail.status, markers.get(detail.uid));
    const generatedAtIso = new Date().toISOString();
    const pdf = await renderCandidateAuditPdf({
      detail: { ...detail, journey },
      generatedAtIso,
      campaignLabel: detail.campaignId
        ? `Campagne ${detail.campaignId}`
        : 'Hors campagne',
    });
    const fileName = auditCandidatFileName(detail.candidateName, generatedAtIso);

    const subject =
      typeof body.subject === 'string' && body.subject.trim().length > 0
        ? body.subject.trim()
        : `Audit candidat — ${detail.candidateName}`;
    const message =
      typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message
        : `Bonjour,\n\nVeuillez trouver ci-joint le rapport d'audit du candidat ${detail.candidateName}.\n\nCordialement,\nORQA`;
    const html = message
      .split('\n')
      .map((line) => `<p>${line || '&nbsp;'}</p>`)
      .join('');

    const result = await sendEmail({
      to: recipients,
      subject,
      html,
      attachments: [{ filename: fileName, content: pdf.toString('base64') }],
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'email_failed' },
        { status: result.error === 'email_not_configured' ? 503 : 502 },
      );
    }

    // Traçabilité de l'envoi (best-effort — ne casse pas un envoi réussi).
    try {
      await appendJournalEntry({
        action: 'audit_candidat_sent',
        actor: 'reporting',
        campaignId: detail.campaignId,
        payload: {
          candidateId: detail.id,
          candidateName: detail.candidateName,
          to: recipients,
          subject,
          messageId: result.messageId,
          fileName,
        },
      });
    } catch (err) {
      if (!(err instanceof SupabaseNotConfiguredError)) {
        console.error('[audit-send] journal failed', err);
      }
    }

    return NextResponse.json({ ok: true, messageId: result.messageId, fileName });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'send_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
