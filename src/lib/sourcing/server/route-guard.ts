/**
 * Garde commune des routes `/api/sourcing/**`.
 *
 * Ordre délibéré : le FLAG d'abord. Module éteint ⇒ 404 pour tout le monde,
 * connecté ou non — la surface n'existe pas, et un 401 ou un 403 la
 * confirmerait. Ensuite l'utilisateur, puis la campagne : on ne source que pour
 * une campagne ACTIVE (les candidatures d'une campagne en brouillon ne seraient
 * pas traitées).
 */
import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  getSourcingApproach,
  getSourcingProfile,
  type SourcingApproachRecord,
  type SourcingProfileRecord,
} from '@/lib/db/repos/sourcing-approaches';
import { isSourcingEnabled } from '@/lib/sourcing/flag';
import type { ActiveCampaign } from '@/stores/campaigns-store';

export const notFound = (): NextResponse =>
  NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

type Guarded<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

export async function guardSourcing(): Promise<Guarded<User>> {
  if (!(await isSourcingEnabled())) return { ok: false, response: notFound() };
  const user = await getApiUser();
  if (!user) return { ok: false, response: unauthorizedResponse() };
  return { ok: true, value: user };
}

export async function guardSourcingCampaign(
  campaignId: string,
): Promise<Guarded<{ user: User; campaign: ActiveCampaign }>> {
  const guard = await guardSourcing();
  if (!guard.ok) return guard;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { ok: false, response: notFound() };
  if (campaign.status !== 'active') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'campaign_not_active' }, { status: 409 }),
    };
  }
  return { ok: true, value: { user: guard.value, campaign } };
}

/** Un profil d'une campagne active. Profil introuvable (décliné, purgé) ⇒ 404. */
export async function guardSourcingProfile(
  profileId: string,
): Promise<Guarded<{ user: User; campaign: ActiveCampaign; profile: SourcingProfileRecord }>> {
  if (!(await isSourcingEnabled())) return { ok: false, response: notFound() };
  const profile = await getSourcingProfile(profileId);
  if (!profile) return { ok: false, response: notFound() };
  const guard = await guardSourcingCampaign(profile.campaignId);
  if (!guard.ok) return guard;
  return { ok: true, value: { ...guard.value, profile } };
}

/**
 * Une approche, par SON recruteur seulement : confirmer ou annuler le geste
 * d'un collègue écrirait une décision à son nom.
 */
export async function guardSourcingApproach(
  approachId: string,
): Promise<Guarded<{ user: User; campaign: ActiveCampaign; approach: SourcingApproachRecord }>> {
  if (!(await isSourcingEnabled())) return { ok: false, response: notFound() };
  const approach = await getSourcingApproach(approachId);
  if (!approach) return { ok: false, response: notFound() };
  const guard = await guardSourcingCampaign(approach.campaignId);
  if (!guard.ok) return guard;
  if (approach.recruiterId !== guard.value.user.id) {
    return { ok: false, response: NextResponse.json({ error: 'not_your_approach' }, { status: 403 }) };
  }
  return { ok: true, value: { ...guard.value, approach } };
}
