/**
 * VUE TRANSVERSE du sourcing — toutes campagnes.
 *
 * ⚠️ LECTURE SEULE, et c'est la règle du module : aucune recherche ne se lance
 * ici. Le gate reste la CAMPAGNE (`SOURCING_ENABLED` + la campagne active),
 * parce que c'est elle qui porte la fiche, les critères et le coût. Cette page
 * répond à « où en sont mes approches ? », pas à « trouve-moi quelqu'un ».
 *
 * Aucune donnée personnelle ne sort d'ici : une approche est une empreinte, un
 * canal, des dates. Le nom de la personne n'est connu qu'après sa
 * manifestation, et il vit alors dans la CANDIDATURE.
 */

import { NextResponse } from 'next/server';

import { requireServerSupabase } from '@/lib/db/supabase-server';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { fetchAllKeyset } from '@/lib/db/paginate';

export const dynamic = 'force-dynamic';

type LigneApproche = {
  id: string;
  campaignId: string;
  canal: string;
  statut: string;
  envoyeeLe: string;
  ouverteLe: string | null;
  repondueLe: string | null;
};

export async function GET() {
  try {
    const db = requireServerSupabase();

    // ⚠️ Keyset, jamais un `select` nu : PostgREST plafonne silencieusement à
    // 1000, et une vue transverse est exactement l'endroit où le volume passe.
    const approches = await fetchAllKeyset<{
      id: string;
      campaign_id: string;
      channel: string;
      status: string;
      initiated_at: string;
      first_opened_at: string | null;
      submitted_at: string | null;
    }>({
      fetchPage: async (after, limit) => {
        let q = db
          .from('sourcing_approaches')
          .select('id, campaign_id, channel, status, initiated_at, first_opened_at, submitted_at')
          .order('id', { ascending: true })
          .limit(limit);
        if (after !== null) q = q.gt('id', after);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
      },
      cursorOf: (r) => r.id,
    });

    // Les oppositions : une empreinte, une raison, rien d'autre. On n'en rend
    // que le COMPTE — les lister ne dirait rien de plus et ferait circuler des
    // empreintes sans usage.
    const { count: oppositions } = await db
      .from('sourcing_exclusions')
      .select('id', { count: 'exact', head: true })
      .eq('reason', 'opposed');

    const lignes: LigneApproche[] = approches.map((a) => ({
      id: a.id,
      campaignId: a.campaign_id,
      canal: a.channel,
      statut: a.status,
      envoyeeLe: a.initiated_at,
      ouverteLe: a.first_opened_at,
      repondueLe: a.submitted_at,
    }));

    const noms = await listCampaignSummaries([
      ...new Set(lignes.map((l) => l.campaignId)),
    ]).catch(() => new Map());

    return NextResponse.json({
      approches: lignes
        .map((l) => ({ ...l, campaignName: noms.get(l.campaignId)?.name ?? null }))
        // Les plus récentes d'abord : une approche d'hier appelle un suivi.
        .sort((a, b) => b.envoyeeLe.localeCompare(a.envoyeeLe)),
      oppositions: oppositions ?? 0,
    });
  } catch (err) {
    // Module éteint, table absente, base non configurée : une vue transverse
    // vide vaut mieux qu'une erreur — mais elle DIT qu'elle n'a rien lu.
    console.error('[sourcing] vue transverse indisponible', err);
    return NextResponse.json({ approches: [], oppositions: 0, indisponible: true });
  }
}
