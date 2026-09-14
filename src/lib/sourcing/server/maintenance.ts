/**
 * Entretien du module Sourcing — branché sur la clôture de campagne et sur le
 * rail de drain (cron de relève en prod, tick du scheduler en dev/VPS).
 * Spec : docs/specs/sourcing.md §10 (étape 9) et §12.1.
 *
 * FAIL-SOFT de bout en bout : rien ici ne doit faire échouer une clôture ni
 * une relève de boîte. Indépendant du flag : des profils à purger ou une
 * candidature en attente ne cessent pas d'exister quand le module s'éteint.
 */

import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  claimAdmissionAttempt,
  findCampaignWithLeftoverProfiles,
  listPendingAdmissions,
  purgeCampaignProfiles,
  type PurgeCount,
} from '@/lib/db/repos/sourcing-admission';
import { getServerSupabase } from '@/lib/db/supabase-server';
import { admissionRetryDue } from '@/lib/sourcing/admission';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';

/** Au plus ce nombre de campagnes purgées par passage du filet. */
const PURGE_SWEEP_MAX = 20;
/** Une admission = une analyse complète : peu par passage, le rail repasse. */
const ADMISSIONS_PER_TICK = 2;

/** Clôture d'une campagne : ses profils sourcés disparaissent, les exclusions restent. */
export async function purgeCampaignSourcing(campaignId: string, trigger: 'closure' | 'sweep'): Promise<PurgeCount | null> {
  if (!getServerSupabase()) return null;
  try {
    const result = await purgeCampaignProfiles(campaignId);
    if (result.count > 0) {
      await appendJournalEntry({
        action: 'sourcing_profiles_purged',
        actor: 'sourcing',
        campaignId,
        payload: { campaignId, count: result.count, byState: result.byState, trigger },
      }).catch(() => {});
    }
    return result;
  } catch (err) {
    console.error('[sourcing] purge de clôture échouée', campaignId, err);
    return null;
  }
}

export type SourcingMaintenanceOutcome = { campaignsPurged: number; admitted: number; deferred: number; closed: number };

export async function runSourcingMaintenance(now: Date = new Date()): Promise<SourcingMaintenanceOutcome> {
  const outcome: SourcingMaintenanceOutcome = { campaignsPurged: 0, admitted: 0, deferred: 0, closed: 0 };
  if (!getServerSupabase()) return outcome;

  // ── Filet : une clôture dont le hook a manqué (process tué, clôture hors route).
  try {
    for (let i = 0; i < PURGE_SWEEP_MAX; i++) {
      const campaignId = await findCampaignWithLeftoverProfiles();
      if (!campaignId) break;
      const purged = await purgeCampaignSourcing(campaignId, 'sweep');
      if (!purged) break; // échec : on ne boucle pas sur la même campagne
      outcome.campaignsPurged++;
    }
  } catch (err) {
    console.error('[sourcing] filet de purge échoué', err);
  }

  // ── Reprise des admissions en panne d'analyse.
  try {
    const pending = (await listPendingAdmissions(20)).filter((a) => admissionRetryDue(a.admissionAttempts, a.updatedAt, now));
    for (const approach of pending.slice(0, ADMISSIONS_PER_TICK)) {
      if (!(await claimAdmissionAttempt(approach))) continue; // un autre passage l'a prise
      const r = await admitSourcedCandidate(approach);
      if (r.kind === 'admitted') outcome.admitted++;
      else if (r.kind === 'closed') outcome.closed++;
      else outcome.deferred++;
    }
  } catch (err) {
    console.error('[sourcing] reprise des admissions échouée', err);
  }
  return outcome;
}
