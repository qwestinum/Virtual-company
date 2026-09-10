/**
 * L'état APEC d'une campagne : le brouillon proposé et la publication en cours.
 *
 * GET seulement. Tout ce qui écrit passe par les sous-routes `publish` et
 * `transition`, pour la même raison que le jobboard sépare « rédiger » de
 * « publier » : une lecture ne doit jamais pouvoir muter quoi que ce soit.
 *
 * La route rend TOUJOURS le brouillon, même quand la publication est
 * impossible — l'écran a besoin de montrer ce qui manque, et un 4xx muet ferait
 * chercher longtemps.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getJobPost } from '@/lib/db/repos/demo-job-posts';
import { getCurrentJobPosting, listJobPostings } from '@/lib/db/repos/job-postings';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSite } from '@/lib/db/repos/sites';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { buildAdepDraft } from '@/lib/jobboards/adep/mapping';
import { prefillFromJobPost, prefillIssues } from '@/lib/jobboards/adep/prefill';
import { buildClientReference, isClientReferenceValid, nextAttempt } from '@/lib/jobboards/adep/reference';
import { isAdepEnabled } from '@/lib/jobboards/adep/service';
import { DEFAULT_ADEP_CONFIG, missingAdepSettings } from '@/types/adep-settings';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await getApiUser())) return unauthorizedResponse();
  const { id } = await context.params;

  try {
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const settings = await getAppSettings().catch(() => null);
    const config = settings?.adepConfig ?? DEFAULT_ADEP_CONFIG;
    const applicationEmail =
      (await resolveCampaignReceptionAddress(id, settings?.intakeEmail)) ?? '';

    // Le code INSEE se saisit une fois sur le site ; sans site, le champ reste
    // vide et l'écran le demande.
    const site = campaign.siteId ? await getSite(campaign.siteId).catch(() => null) : null;

    const previous = await listJobPostings(id, 'apec');
    const attempt = nextAttempt(previous.map((p) => p.clientReference));
    const clientReference = buildClientReference(id, attempt);

    // L'annonce du canal générique fait office de titre et de corps quand elle
    // existe : ce que le recruteur a relu ne se ressaisit pas. On ne GÉNÈRE
    // rien ici — rédiger à l'ouverture d'un panneau serait écrire à la place de
    // quelqu'un, et le ferait à chaque rechargement de l'écran. La
    // rédaction des textes vit dans la sous-route `offer-text`.
    //
    // Fail-soft : la table du jobboard peut être absente d'une installation qui
    // n'a jamais activé la démonstration. Un panneau APEC vide vaut mieux qu'un
    // panneau en erreur.
    const jobPost = await getJobPost(id).catch(() => null);
    const prefill = prefillFromJobPost(jobPost);

    const draft = buildAdepDraft({
      campaignId: id,
      clientReference,
      fdp: campaign.fdp,
      config,
      organizationName: settings?.interviewConfig.organisationName ?? '',
      positionDescription: '',
      profileDescription: '',
      applicationEmail,
      siteInseeCode: site?.inseeCode ?? null,
      prefill,
    });

    // Préalables que le formulaire ne peut pas régler — dits AVANT le bouton.
    const blockers = [...draft.blockers];
    for (const missing of missingAdepSettings(config)) {
      blockers.push(`Réglages APEC du cabinet incomplets : ${missing}.`);
    }
    const owner = campaign.ownerUserId
      ? await getRecruiter(campaign.ownerUserId).catch(() => null)
      : null;
    if (!owner) {
      blockers.push(
        "Cette campagne n'a pas de recruteur référent : l'Apec exige l'identifiant du recruteur qui recevra les candidatures.",
      );
    } else if (!owner.hasAdepNumeroDossier && isAdepEnabled()) {
      blockers.push(
        `${owner.displayName} n'a pas d'identifiant Apec. Renseignez-le sur sa fiche dans les paramètres.`,
      );
    }
    if (!isClientReferenceValid(clientReference)) {
      blockers.push(
        `La référence « ${clientReference} » dépasse les 20 caractères acceptés par l'Apec.`,
      );
    }

    return NextResponse.json({
      simulated: !isAdepEnabled(),
      clientReference,
      draft: draft.offer,
      notes: draft.notes,
      blockers,
      prefill,
      // Les écarts du texte REPRIS, dits à l'ouverture plutôt qu'au clic
      // Publier : un descriptif de 4 200 caractères se raccourcit pendant qu'on
      // remplit le reste, pas au moment d'envoyer.
      prefillIssues: prefill ? prefillIssues(prefill, draft.offer) : [],
      config,
      owner: owner
        ? { id: owner.id, displayName: owner.displayName, hasAdepNumeroDossier: owner.hasAdepNumeroDossier }
        : null,
      posting: await getCurrentJobPosting(id, 'apec'),
      history: previous,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/campaigns/adep] GET failed', err);
    return NextResponse.json({ error: 'adep_state_failed' }, { status: 500 });
  }
}
