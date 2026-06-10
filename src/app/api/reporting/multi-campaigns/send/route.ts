/**
 * POST /api/reporting/multi-campaigns/send — envoie le rapport multi-campagnes
 * par email (cf. docs/specs/reporting.md §4). PDF généré à la volée (pas de
 * cache). Période + filtres en query ; destinataires/sujet/message en body.
 * Traçabilité : journal `multi_campaign_report_sent` (Option A — pas d'UI).
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import {
  defaultMultiCampaignPeriod,
  multiCampaignSendDefaults,
} from '@/lib/reporting/multi-campaign-report-display';
import { renderMultiCampaignReportPdf } from '@/lib/reporting/multi-campaign-report-pdf';
import { assembleMultiCampaignReport } from '@/lib/reporting/multi-campaign-report-loader';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseRecipients(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function POST(request: Request): Promise<NextResponse> {
  const p = new URL(request.url).searchParams;
  const fallback = defaultMultiCampaignPeriod(new Date());
  const from = p.get('from') || fallback.from;
  const to = p.get('to') || fallback.to;

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
    const { data, fileName } = await assembleMultiCampaignReport({
      from,
      to,
      search: p.get('search') ?? undefined,
      donneurOrdreId: p.get('donneur') ?? undefined,
      siteId: p.get('site') ?? undefined,
    });
    const pdf = await renderMultiCampaignReportPdf({
      data,
      generatedAtIso: new Date().toISOString(),
    });

    const defaults = multiCampaignSendDefaults(
      { from, to },
      data.campaignCount,
      data.filters,
    );
    const subject =
      typeof body.subject === 'string' && body.subject.trim().length > 0
        ? body.subject.trim()
        : defaults.subject;
    const message =
      typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message
        : defaults.message;
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

    // Traçabilité (best-effort). Pas d'objet permanent → journal uniquement.
    try {
      await appendJournalEntry({
        action: 'multi_campaign_report_sent',
        actor: 'reporting',
        campaignId: null,
        payload: {
          period: { from, to },
          filters: {
            search: data.filters.search,
            donneur: data.filters.donneurLabel,
            site: data.filters.siteLabel,
          },
          campaignCount: data.campaignCount,
          to: recipients,
          subject,
          messageId: result.messageId,
          fileName,
        },
      });
    } catch (err) {
      if (!(err instanceof SupabaseNotConfiguredError)) {
        console.error('[multi-campaign-send] journal failed', err);
      }
    }

    return NextResponse.json({ ok: true, messageId: result.messageId, fileName });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'send_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
