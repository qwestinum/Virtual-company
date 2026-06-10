/**
 * GET /api/reporting/campaigns — campagnes clôturées + données de carte pour
 * le sous-onglet « Rapport de campagne » (cf. docs/specs/reporting.md §3).
 *
 * Le filtrage / tri / pagination se font côté client (volume MVP faible) : on
 * renvoie tous les résumés de campagnes clôturées accessibles. Lecture seule.
 * Les résumés bruts (loader mutualisé) reçoivent ici la traçabilité journal
 * (envois + dernière génération) pour les mentions de carte.
 */
import { NextResponse } from 'next/server';

import { listJournalEntries, type JournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { loadClosedCampaignReports } from '@/lib/reporting/closed-campaigns-loader';
import type { CampaignReportSend } from '@/types/reporting';

export const runtime = 'nodejs';

function sendFromEntry(e: JournalEntry): CampaignReportSend {
  const to = Array.isArray(e.payload?.to)
    ? (e.payload.to as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const subject = typeof e.payload?.subject === 'string' ? e.payload.subject : '';
  return { at: e.createdAt, to, subject };
}

export async function GET(): Promise<NextResponse> {
  try {
    const [reports, reportJournal] = await Promise.all([
      loadClosedCampaignReports(),
      listJournalEntries({ actionPrefix: 'campaign_report_', limit: 500 }),
    ]);

    const sendsByCampaign = new Map<string, CampaignReportSend[]>();
    const generatedByCampaign = new Map<string, string>();
    for (const e of reportJournal) {
      if (!e.campaignId) continue;
      if (e.action === 'campaign_report_sent') {
        const arr = sendsByCampaign.get(e.campaignId) ?? [];
        arr.push(sendFromEntry(e));
        sendsByCampaign.set(e.campaignId, arr);
      } else if (e.action === 'campaign_report_generated') {
        // listJournalEntries trie par created_at décroissant → 1er = dernier.
        if (!generatedByCampaign.has(e.campaignId)) {
          generatedByCampaign.set(e.campaignId, e.createdAt);
        }
      }
    }

    const campaigns = reports.map(({ summary }) => ({
      ...summary,
      sends: (sendsByCampaign.get(summary.campaignId) ?? []).sort((a, b) =>
        b.at.localeCompare(a.at),
      ),
      generatedAt: generatedByCampaign.get(summary.campaignId) ?? null,
    }));

    return NextResponse.json({ campaigns });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
