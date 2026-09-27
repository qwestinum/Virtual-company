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
 * ⚠️ ET CHACUNE S'AFFICHE DÈS QU'ELLE ARRIVE. Un `Promise.all` suivi d'un
 * unique `setState` faisait attendre l'écran ENTIER derrière la plus lente :
 * mesuré, première peinture à 1 555 ms et contenu complet à 1 569 ms — 14 ms
 * d'écart, autrement dit rien ne se peignait avant que tout soit là. Les
 * cartes se posent maintenant l'une après l'autre, chacune avec son squelette
 * en attendant sa donnée.
 *
 * `dedupeFetch` : le bandeau et cet écran demandent les MÊMES adresses au même
 * instant (`/api/validations`, 46 Ko, partait deux fois). On partage la
 * requête en vol — ce n'est pas un cache, rien n'est conservé, et les
 * compteurs restent rechargés à chaque affichage.
 *
 * Ce sont les MÊMES routes que les écrans de travail (`/api/validations`,
 * `/api/interviews`, `/api/notifications/business`) — c'est ce qui garantit
 * que les compteurs d'ici égalent ceux des puces de là-bas, sans invariant à
 * maintenir : il n'y a qu'une source.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { dedupeFetch } from '@/lib/net/dedupe-fetch';

import { buildTodayBoard, type TodayBoard } from '@/lib/today/board';
import type { ValidationCoherence } from '@/lib/hitl/queue-coherence';
import type {
  ReferentByCampaign,
  ReferentInfo,
} from '@/lib/referent/filter';
import type { BusinessSignal } from '@/types/notifications';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

type ValidationsResponse = {
  validations?: PendingValidation[];
  zoneByValidation?: Record<string, DecisionZone | null>;
  coherenceByValidation?: Record<string, ValidationCoherence>;
  /** Référent par campagne — sert le filtre de LECTURE, jamais un droit. */
  referentByCampaign?: ReferentByCampaign;
  currentUserId?: string | null;
};

type InterviewsResponse = {
  scheduled?: {
    briefId: string;
    uid: string | null;
    referent?: ReferentInfo | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
    section: 'a_pointer' | 'a_venir' | 'verdict_attendu';
  }[];
  verdict?: {
    briefId: string;
    uid: string | null;
    referent?: ReferentInfo | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
  }[];
};

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await dedupeFetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Ce qui est ARRIVÉ, source par source. `null` = pas encore là. */
type Pieces = {
  validations: ValidationsResponse | null | 'echec';
  interviews: InterviewsResponse | null | 'echec';
  notifications: { signals?: BusinessSignal[] } | null | 'echec';
};

const RIEN: Pieces = { validations: null, interviews: null, notifications: null };

/**
 * L'INSTANT du chargement, figé au départ des lectures.
 *
 * ⚠️ Pas `Date.now()` au rendu : les anciennetés (« en attente depuis 9 jours »)
 * se calculeraient contre une horloge qui bouge à chaque re-rendu, et une carte
 * pourrait changer de texte sans qu'aucune donnée n'ait changé. Un chargement,
 * un instant de référence.
 */

/** Une source est-elle encore en route ? */
export type TodayPending = {
  validation: boolean;
  entretiens: boolean;
  verify: boolean;
};

export type TodayState = {
  board: TodayBoard;
  /** Au moins une lecture est TOMBÉE — c'est dit à l'écran. */
  partial: boolean;
  /** Identité du lecteur — sert le raccourci « Mes campagnes ». */
  currentUserId: string | null;
  /** Par carte : sa donnée est-elle encore en route ? */
  pending: TodayPending;
};

export function useTodayBoard(): TodayState & { reload: () => void } {
  const [pieces, setPieces] = useState<Pieces>(RIEN);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(() => {
    setPieces(RIEN);
    setNowMs(Date.now());
    // ⚠️ Trois `setState` séparés, PAS un `Promise.all` : chaque carte se
    // peint dès que SA lecture revient. Attendre les trois faisait payer à
    // l'écran entier le prix de la plus lente.
    void readJson<ValidationsResponse>('/api/validations').then((v) =>
      setPieces((p) => ({ ...p, validations: v ?? 'echec' })),
    );
    void readJson<InterviewsResponse>('/api/interviews').then((v) =>
      setPieces((p) => ({ ...p, interviews: v ?? 'echec' })),
    );
    void readJson<{ signals?: BusinessSignal[] }>('/api/notifications/business').then((v) =>
      setPieces((p) => ({ ...p, notifications: v ?? 'echec' })),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const arrive = <T,>(v: T | null | 'echec'): T | null =>
    v === null || v === 'echec' ? null : v;

  const validations = arrive(pieces.validations);
  const interviews = arrive(pieces.interviews);
  const notifications = arrive(pieces.notifications);

  const board = useMemo(
    () =>
      buildTodayBoard({
        validations: validations?.validations ?? [],
        zoneByValidation: validations?.zoneByValidation ?? {},
        coherenceByValidation: validations?.coherenceByValidation ?? {},
        scheduled: interviews?.scheduled ?? [],
        verdict: interviews?.verdict ?? [],
        signals: notifications?.signals ?? [],
        referentByCampaign: validations?.referentByCampaign ?? {},
        nowMs,
      }),
    [validations, interviews, notifications, nowMs],
  );

  return {
    board,
    currentUserId: validations?.currentUserId ?? null,
    // Une lecture tombée est DITE à l'écran : un « rien ne vous attend »
    // produit par une panne réseau serait le pire mensonge de cet écran.
    partial:
      pieces.validations === 'echec' ||
      pieces.interviews === 'echec' ||
      pieces.notifications === 'echec',
    pending: {
      validation: pieces.validations === null,
      entretiens: pieces.interviews === null,
      verify: pieces.notifications === null,
    },
    reload: load,
  };
}
