/**
 * Ce que la page `/s/<jeton>` et ses routes savent d'un lien reçu.
 * Spec : docs/specs/sourcing.md §9.
 *
 * Un seul résolveur pour la page ET pour les routes de soumission et
 * d'opposition : la page ne montre un formulaire que si la route l'accepterait.
 * Toute panne de lecture donne l'état neutre, jamais une erreur technique.
 */

import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getApproachByTokenHash, getProfileSnapshot, type LandingApproach } from '@/lib/db/repos/sourcing-admission';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getSenderEmail } from '@/lib/email/addresses';
import { hashApproachToken } from '@/lib/sourcing/approach-token';
import { isSourcingEnabled } from '@/lib/sourcing/flag';
import { initialSubmission, recruiterMessageForLanding, resolveLandingState, type LandingState } from '@/lib/sourcing/landing';
import { DEFAULT_BRANDING_CONFIG, resolveOrganizationName } from '@/types/branding';
import { fdpContract, fdpJobTitle, fdpText } from '@/types/job-post';

export type LandingView = {
  organizationName: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  recruiterName: string | null;
  recruiterMessage: string | null;
  job: { title: string; location: string | null; contract: string | null } | null;
  privacyContact: string | null;
  initial: ReturnType<typeof initialSubmission>;
};

export type LandingContext = { state: LandingState; approach: LandingApproach | null; view: LandingView };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

export async function resolveLandingContext(token: string): Promise<LandingContext> {
  const settings = await getAppSettings().catch(() => null);
  const branding = settings?.brandingConfig ?? DEFAULT_BRANDING_CONFIG;
  const view: LandingView = {
    organizationName: resolveOrganizationName(settings),
    logoUrl: branding.logoUrl,
    accentColor: branding.accentColor,
    recruiterName: null,
    recruiterMessage: null,
    job: null,
    privacyContact: null,
    initial: initialSubmission(null),
  };
  const unavailable: LandingContext = { state: { kind: 'unavailable' }, approach: null, view };

  try {
    const moduleEnabled = await isSourcingEnabled();
    if (!moduleEnabled || !TOKEN_SHAPE.test(token)) return unavailable;
    const approach = await getApproachByTokenHash(hashApproachToken(token));
    if (!approach) return unavailable;

    const campaign = await getCampaign(approach.campaignId);
    const profile = approach.profileId ? await getProfileSnapshot(approach.profileId) : null;
    const state = resolveLandingState({
      moduleEnabled,
      approach,
      campaignStatus: campaign?.status ?? null,
      profileAvailable: profile !== null,
    });
    // Offre fermée, lien retiré : AUCUNE donnée affichée, pas même le poste.
    if (state.kind === 'unavailable' || state.kind === 'closed') return { state, approach, view };

    const recruiter = await getRecruiter(approach.recruiterId).catch(() => null);
    view.recruiterName = recruiter?.displayName ?? null;
    view.recruiterMessage = recruiterMessageForLanding(approach.message);
    view.job = campaign ? { title: fdpJobTitle(campaign.fdp), location: fdpText(campaign.fdp, 'location'), contract: fdpContract(campaign.fdp) } : null;
    view.privacyContact =
      settings?.sourcingConfig.privacyContact ??
      (await resolveCampaignReceptionAddress(approach.campaignId, settings?.intakeEmail)) ??
      (await getSenderEmail().catch(() => null));
    if (state.kind === 'form') view.initial = initialSubmission(profile?.snapshot ?? null);
    return { state, approach, view };
  } catch {
    return unavailable;
  }
}
