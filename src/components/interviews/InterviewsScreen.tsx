'use client';

/**
 * Écran Entretiens — l'écran ne bouge pas, il reçoit ses filtres par l'URL.
 *
 * `/entretiens?campagne=CAMP-2026-221&section=a_pointer`. Même contrat que
 * Candidatures : le filtre est écrit en tête et se retire en un clic, et la
 * `key` force le re-montage quand l'adresse change (l'écran applique sa
 * section d'ouverture au montage).
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ActiveFilterBar, type ActiveFilter } from '@/components/workspace/ActiveFilterBar';
import {
  interviewsHref,
  PARAM,
  readInterviewsFilter,
} from '@/lib/navigation/workspace-routes';
import { selectActiveCampaigns, useCampaignsStore } from '@/stores/campaigns-store';

import { InterviewsWorkspace } from './InterviewsWorkspace';

const SECTION_LABEL = {
  a_pointer: 'Entretiens à pointer',
  awaiting: 'En attente de réservation',
} as const;

export function InterviewsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = readInterviewsFilter(
    new URLSearchParams(params?.toString() ?? ''),
  );
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));

  const campaignLabel = (id: string): string => {
    const c = campaigns.find((x) => x.id === id);
    const title = c?.fdp.fields.job_title?.value;
    return typeof title === 'string' && title.trim() ? `${id} · ${title.trim()}` : id;
  };

  const canonical = interviewsHref(filter);
  const current = `${pathname}${params?.toString() ? `?${params.toString()}` : ''}`;
  useEffect(() => {
    if (current !== canonical) router.replace(canonical);
  }, [current, canonical, router]);

  const filters: ActiveFilter[] = [];
  if (filter.campaignId) {
    filters.push({
      key: PARAM.campagne,
      label: campaignLabel(filter.campaignId),
      withoutHref: interviewsHref({ ...filter, campaignId: null }),
    });
  }
  if (filter.section) {
    filters.push({
      key: PARAM.section,
      label: SECTION_LABEL[filter.section],
      withoutHref: interviewsHref({ ...filter, section: null }),
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
      {/* ⚠️ `relative` : le gabarit de page est en `position: absolute; inset: 0`.
          Sans ancêtre positionné ICI, il se cale sur le cadre du workspace et
          passe SOUS le bandeau des filtres (titre à cheval sur la barre). */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <InterviewsWorkspace
          key={canonical}
          initialSection={filter.section ?? null}
          campaignId={filter.campaignId ?? null}
        />
      </div>
    </div>
  );
}
