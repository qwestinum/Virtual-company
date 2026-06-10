/**
 * GET /api/reporting/campaigns — campagnes clôturées + données de carte pour
 * le sous-onglet « Rapport de campagne » (cf. docs/specs/reporting.md §3).
 *
 * Le filtrage / tri / pagination se font côté client (volume MVP faible) : on
 * renvoie tous les résumés de campagnes clôturées accessibles. Lecture seule.
 */
import { NextResponse } from 'next/server';

import { listClosedCampaigns } from '@/lib/db/repos/campaigns';
import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listDonneursOrdre } from '@/lib/db/repos/donneurs-ordre';
import { listJournalEntries, type JournalEntry } from '@/lib/db/repos/journal';
import { listSites } from '@/lib/db/repos/sites';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  buildCampaignReportSummary,
  type CampaignReportMeta,
} from '@/lib/reporting/campaign-report';
import {
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type {
  CampaignAnalysisDatum,
  CampaignReportSend,
} from '@/types/reporting';

export const runtime = 'nodejs';

function jobTitleOf(c: ActiveCampaign): string {
  const v = c.fdp?.fields?.job_title?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : c.name;
}

/** « Prénom Nom » (ou Nom seul) pour un donneur d'ordre. */
function donneurLabel(firstName: string | null, lastName: string): string {
  return firstName && firstName.trim().length > 0
    ? `${firstName.trim()} ${lastName}`
    : lastName;
}

function sendFromEntry(e: JournalEntry): CampaignReportSend {
  const to = Array.isArray(e.payload?.to)
    ? (e.payload.to as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const subject = typeof e.payload?.subject === 'string' ? e.payload.subject : '';
  return { at: e.createdAt, to, subject };
}

export async function GET(): Promise<NextResponse> {
  try {
    const [campaigns, analyses, signals, sites, donneurs, reportJournal] =
      await Promise.all([
        listClosedCampaigns(),
        listCandidateAnalyses({ limit: 1000 }),
        loadJourneySignals(),
        listSites({ includeArchived: true }),
        listDonneursOrdre({ includeArchived: true }),
        listJournalEntries({ actionPrefix: 'campaign_report_', limit: 500 }),
      ]);

    const siteById = new Map(sites.map((s) => [s.id, s]));
    const donneurById = new Map(donneurs.map((d) => [d.id, d]));

    // Groupe analyses + journal d'envoi/génération par campagne (1 passe).
    const analysesByCampaign = new Map<string, typeof analyses>();
    for (const a of analyses) {
      if (!a.campaignId) continue;
      const arr = analysesByCampaign.get(a.campaignId) ?? [];
      arr.push(a);
      analysesByCampaign.set(a.campaignId, arr);
    }
    const sendsByCampaign = new Map<string, CampaignReportSend[]>();
    const generatedByCampaign = new Map<string, string>();
    for (const e of reportJournal) {
      if (!e.campaignId) continue;
      if (e.action === 'campaign_report_sent') {
        const arr = sendsByCampaign.get(e.campaignId) ?? [];
        arr.push(sendFromEntry(e));
        sendsByCampaign.set(e.campaignId, arr);
      } else if (e.action === 'campaign_report_generated') {
        // listJournalEntries trie déjà par created_at décroissant → 1er = dernier.
        if (!generatedByCampaign.has(e.campaignId)) {
          generatedByCampaign.set(e.campaignId, e.createdAt);
        }
      }
    }

    const summaries = campaigns.map((c) => {
      const own = analysesByCampaign.get(c.id) ?? [];
      const data: CampaignAnalysisDatum[] = own.map((a) => {
        const j = journeyFromSignals(signals, a.uid, a.status, a.hitlConfig);
        return {
          status: a.status,
          totalScore: a.totalScore,
          source: a.source,
          humanIntervention: j.humanIntervention,
          recruited: j.final === 'retenu',
          contacted:
            j.final !== 'na' ||
            j.validation === 'retenu_entretien' ||
            j.interview !== 'na',
        };
      });
      const donneur = c.donneurOrdreId ? donneurById.get(c.donneurOrdreId) : null;
      const site = c.siteId ? siteById.get(c.siteId) : null;
      const meta: CampaignReportMeta = {
        campaignId: c.id,
        campaignName: c.name,
        jobTitle: jobTitleOf(c),
        // Repli historique : created_at / updated_at quand les dates de cycle
        // de vie n'ont pas été posées.
        launchedAt: c.launchedAt ?? c.createdAt,
        closedAt: c.closedAt ?? c.updatedAt,
        donneurOrdre: donneur
          ? {
              label: donneurLabel(donneur.firstName, donneur.lastName),
              role: donneur.role,
            }
          : null,
        donneurOrdreId: c.donneurOrdreId,
        siteLabel: site?.name ?? null,
      };
      return buildCampaignReportSummary(
        meta,
        data,
        sendsByCampaign.get(c.id) ?? [],
        generatedByCampaign.get(c.id) ?? null,
      );
    });

    return NextResponse.json({ campaigns: summaries });
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
