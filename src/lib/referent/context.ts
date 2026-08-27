/**
 * Résolution SERVEUR du recruteur référent d'un ensemble de campagnes.
 *
 * Point unique, partagé par toutes les surfaces qui affichent la mention
 * (file des validations, menu Candidatures) : deux requêtes pour une page
 * entière, JAMAIS une par ligne.
 *
 *   1. `listCampaignSummaries` — projection minimale, chunkée, insensible au
 *      volume de la table `campaigns` (là où `listCampaigns()` retombe
 *      silencieusement sous le plafond PostgREST de 1000).
 *   2. `listRecruiters` — le référentiel entier tient en quelques lignes.
 *
 * Les recruteurs DÉSACTIVÉS sont chargés eux aussi et rendus tels quels
 * (`isActive: false`) : c'est l'AFFICHAGE qui en fait « référent non défini ».
 * Les écraser ici rendrait « désactivé » et « jamais désigné » indistinguables,
 * et personne ne pourrait plus diagnostiquer un référent perdu.
 *
 * `currentUserId` est rendu par la ROUTE et non passé par la page : les hubs
 * concernés ont plusieurs points de montage, un seul chemin vaut mieux que des
 * props à tenir synchronisées.
 *
 * FAIL-SOFT intégral : toute panne rend un contexte vide (aucun référent, pas
 * de raccourci « Mes campagnes »), jamais une erreur. Le filtre est un confort
 * de lecture — il ne doit jamais emporter les dossiers eux-mêmes.
 */

import { getApiUser } from '@/lib/auth/require-api-user';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { listRecruiters } from '@/lib/db/repos/recruiters';

import type { ReferentInfo } from './filter';

export type ReferentContext = {
  referentByCampaign: Record<string, ReferentInfo | null>;
  currentUserId: string | null;
};

export async function loadReferentContext(
  campaignIds: readonly (string | null)[],
): Promise<ReferentContext> {
  try {
    const ids = [
      ...new Set(campaignIds.filter((id): id is string => Boolean(id))),
    ];
    const [campaigns, recruiters, user] = await Promise.all([
      listCampaignSummaries(ids),
      listRecruiters().catch(() => []),
      getApiUser().catch(() => null),
    ]);
    const byId = new Map(recruiters.map((r) => [r.id, r]));
    const referentByCampaign: Record<string, ReferentInfo | null> = {};
    for (const id of ids) {
      const ownerId = campaigns.get(id)?.ownerUserId ?? null;
      const recruiter = ownerId ? byId.get(ownerId) : undefined;
      referentByCampaign[id] = recruiter
        ? {
            id: recruiter.id,
            displayName: recruiter.displayName,
            isActive: recruiter.isActive,
          }
        : null;
    }
    return { referentByCampaign, currentUserId: user?.id ?? null };
  } catch (err) {
    console.error('[referent] context resolution failed', err);
    return { referentByCampaign: {}, currentUserId: null };
  }
}
