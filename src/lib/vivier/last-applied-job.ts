/**
 * Résolution du « dernier poste visé » d'un ou plusieurs candidats vivier
 * (Session V3 — contexte de validation). DÉRIVÉ, non stocké : la candidature la
 * plus récente d'un email (candidate_analyses) → la campagne → son intitulé de
 * poste (FDP, repli sur le nom). Batch (1 requête analyses + N campagnes
 * distinctes) pour alimenter la liste de validation sans N requêtes. Server-only.
 */

import { getLatestApplicationsByEmails } from '@/lib/db/repos/candidate-analyses';
import { getCampaign } from '@/lib/db/repos/campaigns';
import type { ActiveCampaign } from '@/stores/campaigns-store';

export type LastAppliedJob = { jobTitle: string; at: string };

function jobTitleOf(c: ActiveCampaign): string {
  const v = c.fdp?.fields?.job_title?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : c.name;
}

/**
 * Map email (minuscules) → dernier poste visé. Emails sans candidature (ou dont
 * la campagne est introuvable) sont absents du Map.
 */
export async function resolveLastAppliedJobs(
  emails: string[],
): Promise<Map<string, LastAppliedJob>> {
  const out = new Map<string, LastAppliedJob>();
  const apps = await getLatestApplicationsByEmails(emails);
  if (apps.size === 0) return out;

  const campaignIds = [
    ...new Set(
      [...apps.values()]
        .map((a) => a.campaignId)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const campaigns = await Promise.all(campaignIds.map((cid) => getCampaign(cid)));
  const titleById = new Map<string, string>();
  for (const c of campaigns) if (c) titleById.set(c.id, jobTitleOf(c));

  for (const [email, a] of apps) {
    const title = a.campaignId ? titleById.get(a.campaignId) : undefined;
    if (title) out.set(email, { jobTitle: title, at: a.receivedAt });
  }
  return out;
}
