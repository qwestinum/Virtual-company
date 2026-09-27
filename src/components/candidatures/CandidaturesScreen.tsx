'use client';

/**
 * Écran Candidatures — la vue elle-même est INCHANGÉE ; ce qui est neuf, c'est
 * qu'elle a une adresse et qu'elle reçoit ses filtres par l'URL.
 *
 * `/candidatures?campagne=CAMP-2026-221&statut=a_valider` est désormais un lien
 * partageable, un favori, et une cible pour un signal métier — trois choses
 * qu'aucun écran du produit ne savait faire.
 *
 * La `key` force le re-montage quand l'URL change : `CandidaturesWorkspace`
 * applique ses pré-filtres UNE fois au montage (c'est son contrat, il n'a pas
 * bougé). Sans elle, cliquer un second lien filtré ne changerait rien à
 * l'écran — le pire des deux mondes : l'adresse dirait une chose, la liste une
 * autre.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ActiveFilterBar, type ActiveFilter } from '@/components/workspace/ActiveFilterBar';
import {
  candidaturesHref,
  PARAM,
  readCandidaturesFilter,
} from '@/lib/navigation/workspace-routes';
import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';
import { selectActiveCampaigns, useCampaignsStore } from '@/stores/campaigns-store';

import { CandidaturesWorkspace } from './CandidaturesWorkspace';

const PARCOURS_LABEL = {
  invitation: 'Passés par l’invitation',
  entretien: 'Passés par l’entretien',
} as const;

export function CandidaturesScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = readCandidaturesFilter(
    new URLSearchParams(params?.toString() ?? ''),
  );
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));

  // Une campagne nommée dans l'URL mais inconnue du store : on garde l'ID
  // affiché tel quel plutôt que d'effacer le filtre en silence — le recruteur
  // doit voir sur quoi il est filtré, même si le nom n'est pas (encore) chargé.
  const campaignLabel = (id: string): string => {
    const c = campaigns.find((x) => x.id === id);
    const title = c?.fdp.fields.job_title?.value;
    return typeof title === 'string' && title.trim() ? `${id} · ${title.trim()}` : id;
  };

  // Une adresse portant un paramètre inconnu (lien vieilli, faute de frappe)
  // est RÉÉCRITE sur ce qui a été compris : l'URL et l'écran doivent dire la
  // même chose, sinon le lien partagé ment à son destinataire.
  const canonical = candidaturesHref(filter);
  const current = `${pathname}${params?.toString() ? `?${params.toString()}` : ''}`;
  useEffect(() => {
    if (current !== canonical) router.replace(canonical);
  }, [current, canonical, router]);

  const filters: ActiveFilter[] = [];
  if (filter.campaignId) {
    filters.push({
      key: PARAM.campagne,
      label: campaignLabel(filter.campaignId),
      withoutHref: candidaturesHref({ ...filter, campaignId: null }),
    });
  }
  if (filter.stage) {
    filters.push({
      key: PARAM.statut,
      label: CANDIDATE_STAGE_LABELS[filter.stage],
      withoutHref: candidaturesHref({ ...filter, stage: null }),
    });
  }
  if (filter.parcours) {
    filters.push({
      key: PARAM.parcours,
      label: PARCOURS_LABEL[filter.parcours],
      withoutHref: candidaturesHref({ ...filter, parcours: null }),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <ActiveFilterBar
        filters={filters}
        back={
          filter.campaignId
            ? {
                label: 'Retour à la campagne',
                href: `/campagnes?${PARAM.campagne}=${encodeURIComponent(filter.campaignId)}`,
              }
            : null
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <CandidaturesWorkspace
          key={canonical}
          initialStage={filter.stage ?? null}
          initialCampaignId={filter.campaignId ?? null}
          initialEverInvited={filter.parcours === 'invitation'}
          initialEverInterviewed={filter.parcours === 'entretien'}
        />
      </div>
    </div>
  );
}
