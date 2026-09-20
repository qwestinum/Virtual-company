'use client';

/**
 * Écran Campagnes — les compteurs d'une carte deviennent des LIENS, et la
 * campagne elle-même devient une adresse.
 *
 * Avant, un compteur appelait une fonction qui changeait un `useState` du
 * parent : rien dans l'URL, donc rien à partager et aucun retour possible.
 * `/campagnes?campagne=CAMP-2026-221` ouvre désormais CETTE campagne — c'est
 * ce qui rend le « retour à la campagne » de l'écran Candidatures littéral
 * plutôt qu'approximatif.
 */

import { useRouter, useSearchParams } from 'next/navigation';

import { candidaturesHref, PARAM } from '@/lib/navigation/workspace-routes';

import { CampaignsWorkspace } from './CampaignsWorkspace';

export function CampaignsScreen() {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <CampaignsWorkspace
      focusCampaignId={params?.get(PARAM.campagne) ?? null}
      openCreate={params?.get('nouvelle') === '1'}
      onOpenCandidatures={(campaignId, preset) =>
        router.push(
          candidaturesHref({
            campaignId,
            stage: preset.stage,
            parcours: preset.everInvited
              ? 'invitation'
              : preset.everInterviewed
                ? 'entretien'
                : null,
          }),
        )
      }
    />
  );
}
