'use client';

/**
 * Chargement d'*Aujourd'hui* — TROIS lectures en PARALLÈLE, à chaque affichage.
 *
 * Pas de cache, et c'est une décision : cet écran ne raconte rien, il compte ce
 * qui attend. Un compteur servi depuis un cache dit « 6 choses vous attendent »
 * alors qu'on vient d'en traiter trois — et il n'y a pas de faute plus grave
 * pour un écran dont c'est l'unique fonction. `cache: 'no-store'`, et un
 * rechargement à chaque montage.
 *
 * Les trois lectures partent ENSEMBLE : elles ne se dépendent pas, et les
 * enchaîner ferait attendre l'écran trois fois pour rien. Chacune tombe seule :
 * une panne des entretiens ne doit pas effacer les dossiers à décider.
 *
 * Ce sont les MÊMES routes que les écrans de travail (`/api/validations`,
 * `/api/interviews`, `/api/notifications/business`) — c'est ce qui garantit
 * que les compteurs d'ici égalent ceux des puces de là-bas, sans invariant à
 * maintenir : il n'y a qu'une source.
 */

import { useCallback, useEffect, useState } from 'react';

import { buildTodayBoard, type TodayBoard } from '@/lib/today/board';
import type { ValidationCoherence } from '@/lib/hitl/queue-coherence';
import type { BusinessSignal } from '@/types/notifications';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

type ValidationsResponse = {
  validations?: PendingValidation[];
  zoneByValidation?: Record<string, DecisionZone | null>;
  coherenceByValidation?: Record<string, ValidationCoherence>;
};

type InterviewsResponse = {
  scheduled?: {
    briefId: string;
    uid: string | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
    section: 'a_pointer' | 'a_venir' | 'verdict_attendu';
  }[];
  verdict?: {
    briefId: string;
    uid: string | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
  }[];
};

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type TodayState =
  | { kind: 'loading' }
  | { kind: 'ready'; board: TodayBoard; partial: boolean };

export function useTodayBoard(): TodayState & { reload: () => void } {
  const [state, setState] = useState<TodayState>({ kind: 'loading' });

  const load = useCallback(async () => {
    const [validations, interviews, notifications] = await Promise.all([
      readJson<ValidationsResponse>('/api/validations'),
      readJson<InterviewsResponse>('/api/interviews'),
      readJson<{ signals?: BusinessSignal[] }>('/api/notifications/business'),
    ]);

    setState({
      kind: 'ready',
      // Une lecture tombée est DITE à l'écran : un « rien ne vous attend »
      // produit par une panne réseau serait le pire mensonge de cet écran.
      partial:
        validations === null || interviews === null || notifications === null,
      board: buildTodayBoard({
        validations: validations?.validations ?? [],
        zoneByValidation: validations?.zoneByValidation ?? {},
        coherenceByValidation: validations?.coherenceByValidation ?? {},
        scheduled: interviews?.scheduled ?? [],
        verdict: interviews?.verdict ?? [],
        signals: notifications?.signals ?? [],
        nowMs: Date.now(),
      }),
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { ...state, reload: () => void load() };
}
