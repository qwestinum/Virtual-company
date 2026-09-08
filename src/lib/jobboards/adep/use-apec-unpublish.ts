'use client';

/**
 * L'option « dépublier l'annonce APEC » du dialog de clôture.
 *
 * Extraite du dialog pour ne pas le faire grossir, et parce que les deux
 * règles qu'elle porte méritent d'être lisibles d'un coup :
 *
 *   1. le CHARGEMENT est FAIL-SOFT — un connecteur APEC indisponible ne doit
 *      jamais empêcher de clôturer une campagne ;
 *   2. la DÉPUBLICATION se tente APRÈS la clôture, et son échec ne la remet pas
 *      en cause : fermer la campagne est l'intention principale. On le DIT, et
 *      le signal « offre en ligne sur une campagne clôturée » rattrape.
 */
import { useCallback, useEffect, useState } from 'react';

import { loadAdepState, transitionApec } from './panel-client';

export type ApecUnpublishState = {
  /** `null` ⇒ aucune offre en ligne : rien à proposer. */
  live: { numero: string | null } | null;
  checked: boolean;
  setChecked: (checked: boolean) => void;
  /**
   * Tente la dépublication si elle a été demandée. Rend un message d'erreur à
   * afficher, ou `null` — jamais une exception : la clôture a déjà eu lieu.
   */
  unpublishIfRequested: () => Promise<string | null>;
};

export function useApecUnpublish(
  campaignId: string,
  enabled: boolean,
): ApecUnpublishState {
  const [live, setLive] = useState<{ numero: string | null } | null>(null);
  // Cochée par défaut : c'est presque toujours ce qu'on veut. Le geste reste
  // celui du recruteur — retirer une annonce d'apec.fr est une action
  // sortante et visible du public.
  const [checked, setChecked] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const state = await loadAdepState(campaignId).catch(() => null);
      if (cancelled || !state?.posting) return;
      if (state.posting.remoteStatus !== 'PUBLIEE') return;
      setLive({ numero: state.posting.apecPositionNumero });
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, enabled]);

  const unpublishIfRequested = useCallback(async (): Promise<string | null> => {
    if (!enabled || !live || !checked) return null;
    const outcome = await transitionApec(campaignId, 'suspend').catch(() => null);
    const kind = outcome?.outcome?.kind;
    if (kind === 'changed' || kind === 'already_in_state') return null;
    return (
      'La campagne est clôturée, mais l’offre APEC n’a pas pu être dépubliée. ' +
      'Elle reste en ligne : réessayez depuis l’onglet Campagnes, ou dépubliez-la ' +
      'sur apec.fr.'
    );
  }, [campaignId, checked, enabled, live]);

  return { live, checked, setChecked, unpublishIfRequested };
}
