'use client';

/**
 * Écran Campagnes — la campagne devient une adresse.
 *
 * `/campagnes?campagne=CAMP-2026-221` ouvre CETTE campagne : c'est ce qui rend
 * le « retour à la campagne » de l'écran Candidatures littéral plutôt
 * qu'approximatif. `?nouvelle=1` ouvre la création.
 *
 * ⚠️ Plus de `onOpenCandidatures` : les compteurs de la carte sont désormais
 * des LIENS, construits par `card-detail.ts`. Faire remonter un clic jusqu'ici
 * pour redescendre en navigation n'avait de sens que tant qu'il n'existait
 * aucune URL.
 */

import { useSearchParams } from 'next/navigation';

import { PARAM } from '@/lib/navigation/workspace-routes';
import type { BlockKey } from './edit/CampaignEditAccordion';

import { CampaignsWorkspace } from './CampaignsWorkspace';

/**
 * Blocs d'édition atteignables par l'URL. Liste EXPLICITE : une valeur
 * quelconque venue de l'adresse ne doit pas ouvrir un bloc au hasard — ni
 * faire planter l'écran.
 */
const SECTIONS_OUVRABLES: readonly BlockKey[] = ['channels', 'vivier', 'flux'];

function lireSection(brut: string | null): BlockKey | null {
  return SECTIONS_OUVRABLES.includes(brut as BlockKey) ? (brut as BlockKey) : null;
}

export function CampaignsScreen() {
  const params = useSearchParams();

  return (
    <CampaignsWorkspace
      focusCampaignId={params?.get(PARAM.campagne) ?? null}
      openCreate={params?.get('nouvelle') === '1'}
      openSection={lireSection(params?.get('ouvrir') ?? null)}
    />
  );
}
