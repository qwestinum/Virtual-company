/**
 * Choix de la campagne sur laquelle S29 clique.
 *
 * Pas d'identifiant écrit en dur : une base de dev se réinitialise, et un test
 * qui nomme `CAMP-2026-095` deviendrait rouge pour une raison qui n'a rien à
 * voir avec la porte qu'il surveille. On demande ce dont le scénario A BESOIN
 * — une campagne ACTIVE (les portes sont fermées sur un brouillon, et c'est
 * voulu) qui porte au moins une proposition vivier à examiner.
 *
 * `E2E_CAMPAIGN_ID` force le choix quand on veut recetter un cas précis.
 */
import { createClient } from '@supabase/supabase-js';

export type E2ECampaign = { id: string; name: string; hasVivierProposal: boolean };

export async function pickCampaign(): Promise<E2ECampaign> {
  const forced = process.env.E2E_CAMPAIGN_ID;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: actives, error } = await db
    .from('campaigns')
    .select('id, name, status, sources')
    .eq('status', 'active');
  if (error) throw new Error(`Suite E2E : lecture des campagnes impossible — ${error.message}`);

  const candidates = (actives ?? []).filter((c) => !forced || c.id === forced);
  if (candidates.length === 0) {
    throw new Error(
      forced
        ? `Suite E2E : la campagne ${forced} n'est pas active dans cette base.`
        : 'Suite E2E : aucune campagne active dans cette base — S29 clique sur des portes qui n’existent que là.',
    );
  }

  const { data: props } = await db
    .from('vivier_preselections')
    .select('campaign_id')
    .eq('state', 'identified')
    .in('campaign_id', candidates.map((c) => c.id));
  const avecProposition = new Set((props ?? []).map((p) => p.campaign_id as string));

  const choisie =
    candidates.find((c) => avecProposition.has(c.id)) ?? candidates[0]!;
  return {
    id: choisie.id as string,
    name: choisie.name as string,
    hasVivierProposal: avecProposition.has(choisie.id as string),
  };
}
