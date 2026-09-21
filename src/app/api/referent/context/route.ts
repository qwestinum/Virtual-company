/**
 * Le référent de CHAQUE campagne, plus l'identité de la session.
 *
 * ⚠️ Point unique pour les écrans CLIENTS qui portent le filtre « Référent »
 * (Campagnes, Candidatures, Pilotage, Aujourd'hui). La file des validations et
 * l'onglet Entretiens, eux, reçoivent déjà ce contexte DANS leur propre
 * réponse — ils n'ont pas à faire un second aller-retour pour une donnée
 * qu'ils ont en main. Cette route sert ceux qui ne l'ont pas.
 *
 * FAIL-SOFT intégral, comme `loadReferentContext` : toute panne rend un
 * contexte vide (aucun référent, pas de raccourci « Mes campagnes »), jamais
 * une erreur. Le filtre est un confort de lecture — il ne doit jamais emporter
 * la liste elle-même.
 */

import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import { listAllCampaignOwners } from '@/lib/db/repos/campaigns';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import type { ReferentInfo } from '@/lib/referent/filter';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [campaigns, recruiters, user] = await Promise.all([
      listAllCampaignOwners(),
      listRecruiters().catch(() => []),
      getApiUser().catch(() => null),
    ]);
    // Les recruteurs DÉSACTIVÉS sont rendus tels quels (`isActive: false`) :
    // c'est l'AFFICHAGE qui en fait « référent non défini ». Les écraser ici
    // rendrait « désactivé » et « jamais désigné » indistinguables.
    const byId = new Map(recruiters.map((r) => [r.id, r]));
    const referentByCampaign: Record<string, ReferentInfo | null> = {};
    for (const c of campaigns) {
      const r = c.ownerUserId ? byId.get(c.ownerUserId) : undefined;
      referentByCampaign[c.id] = r
        ? { id: r.id, displayName: r.displayName, isActive: r.isActive }
        : null;
    }
    return NextResponse.json({
      referentByCampaign,
      currentUserId: user?.id ?? null,
    });
  } catch (err) {
    console.error('[referent] context route failed', err);
    return NextResponse.json({ referentByCampaign: {}, currentUserId: null });
  }
}
