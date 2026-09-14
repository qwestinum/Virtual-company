/**
 * Résolution du « dernier poste visé » d'un ou plusieurs candidats vivier
 * (Session V3 — contexte de validation). DÉRIVÉ, non stocké : la candidature la
 * plus récente d'un email (candidate_analyses) → la campagne → son intitulé de
 * poste (FDP, repli sur le nom). Batch : 1 requête analyses + 1 lecture groupée
 * (chunkée) des intitulés des campagnes distinctes. Server-only.
 */

import { getLatestApplicationsByEmails } from '@/lib/db/repos/candidate-analyses';
import { listCampaignJobTitles } from '@/lib/db/repos/campaigns';

export type LastAppliedJob = { jobTitle: string; at: string };

/** Intitulé FDP s'il est une chaîne non vide, sinon le nom de la campagne. */
export function jobTitleOf(c: { name: string; jobTitleValue: unknown }): string {
  const v = c.jobTitleValue;
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
  const campaigns = await listCampaignJobTitles(campaignIds);
  const titleById = new Map<string, string>();
  for (const [id, c] of campaigns) titleById.set(id, jobTitleOf(c));

  for (const [email, a] of apps) {
    const title = a.campaignId ? titleById.get(a.campaignId) : undefined;
    if (title) out.set(email, { jobTitle: title, at: a.receivedAt });
  }
  return out;
}
