/**
 * POST /api/reporting/campaigns/[id]/send — envoie le rapport de campagne par
 * email (cf. docs/specs/reporting.md §3.5). PDF depuis le cache si présent,
 * généré à la volée sinon. Chaque envoi est consigné au journal (traçabilité
 * RGPD : date, destinataires, sujet, message-id).
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import { renderCampaignReportPdf } from '@/lib/reporting/campaign-report-pdf';
import { assembleCampaignReport } from '@/lib/reporting/campaign-report-loader';
import { downloadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const maxDuration = 30;

function parseRecipients(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
    const report = await assembleCampaignReport(id);
    if (!report) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const { data, fileName } = report;
    const cachePath = `campagnes/${id}/${fileName}`;

    // PDF depuis le cache, sinon génération à la volée (puis mise en cache).
    let pdf = await downloadArtifact(cachePath);
    if (!pdf) {
      pdf = await renderCampaignReportPdf({
        data,
        generatedAtIso: new Date().toISOString(),
      });
      try {
        await uploadArtifactBinary({
          owner: { kind: 'campaign', id },
          name: fileName,
          content: pdf,
          mimeType: 'application/pdf',
        });
        await appendJournalEntry({
          action: 'campaign_report_generated',
          actor: 'reporting',
          campaignId: id,
          payload: { fileName, viaSend: true },
        });
      } catch (err) {
        if (!(err instanceof SupabaseNotConfiguredError)) {
          console.error('[campaign-report-send] cache failed', err);
        }
      }
    }

    const subject =
      typeof body.subject === 'string' && body.subject.trim().length > 0
        ? body.subject.trim()
        : `Rapport de campagne — ${data.summary.jobTitle}`;
    const message =
      typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message
        : `Bonjour,\n\nVous trouverez en pièce jointe le rapport de la campagne de recrutement « ${data.summary.jobTitle} ».\n\nCordialement,\nORQA`;
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
        action: 'campaign_report_sent',
        actor: 'reporting',
        campaignId: id,
        payload: {
          to: recipients,
          subject,
          messageId: result.messageId,
          fileName,
        },
      });
    } catch (err) {
      if (!(err instanceof SupabaseNotConfiguredError)) {
        console.error('[campaign-report-send] journal failed', err);
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
