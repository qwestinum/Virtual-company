'use client';

/**
 * Options du sélecteur « Recruteur référent », partagées par les écrans qui
 * choisissent un référent (édition d'une campagne, création d'un brouillon).
 *
 * Un seul fetch pour DEUX consommateurs : le sélecteur de référent et la
 * bascule de réservation native, qui a besoin de savoir si le référent
 * pressenti a des disponibilités — sinon le serveur refuse l'activation
 * (`owner_not_bookable`) et l'écran ne saurait pas le dire à l'avance.
 *
 * Fail-soft de bout en bout : réseau KO, Supabase absent, session illisible ⇒
 * liste vide et `currentUserId: null`. L'appelant rend alors « aucun référent
 * (agenda global) », ce qui est vrai, plutôt que de bloquer la création.
 */

import { useEffect, useState } from 'react';

export type RecruiterOption = {
  id: string;
  displayName: string;
  hasCalcomLink: boolean;
  /** `null` = indéterminé (module de réservation injoignable). */
  hasAvailability: boolean | null;
};

export type RecruiterOptions = {
  /** `null` tant que la réponse n'est pas arrivée (≠ liste vide). */
  options: RecruiterOption[] | null;
  /** Utilisateur courant — le référent par défaut d'une campagne qu'il crée. */
  currentUserId: string | null;
};

export function useRecruiterOptions(): RecruiterOptions {
  const [state, setState] = useState<RecruiterOptions>({
    options: null,
    currentUserId: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/recruiters/options', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setState({ options: [], currentUserId: null });
          return;
        }
        const json = (await res.json()) as {
          options?: RecruiterOption[];
          currentUserId?: string | null;
        };
        if (!cancelled) {
          setState({
            options: json.options ?? [],
            currentUserId: json.currentUserId ?? null,
          });
        }
      } catch {
        if (!cancelled) setState({ options: [], currentUserId: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Référent EFFECTIF d'un brouillon de campagne : le choix de l'utilisateur s'il
 * a tranché (`null` compris — « aucun référent » est un choix), sinon le défaut.
 *
 * Le défaut est le créateur, comme le fait le serveur quand le champ est absent
 * — mais seulement s'il figure parmi les recruteurs ACTIFS : désigner un
 * référent inactif (ou inconnu du référentiel) poserait un agenda dont aucun
 * candidat ne pourrait rien faire. Liste pas encore arrivée ⇒ aucun défaut, pas
 * un nom deviné. Pur — testé.
 */
export function resolveDraftOwner(
  choice: string | null | undefined,
  options: RecruiterOption[] | null,
  currentUserId: string | null,
): string | null {
  if (choice !== undefined) return choice;
  if (options === null || currentUserId === null) return null;
  return options.some((o) => o.id === currentUserId) ? currentUserId : null;
}

/**
 * Ce qu'on signale à côté du nom d'un recruteur.
 *
 * `availability` = ses disponibilités dans ORQA — le seul manque qui compte
 * pour une campagne NEUVE : Cal.com est en extinction, et prévenir qu'un
 * recruteur n'a pas de lien Cal.com serait pousser vers le régime qu'on quitte.
 * `calcom` ne sert plus qu'aux campagnes qui tournent ENCORE sur Cal.com, où le
 * lien manquant est un vrai problème présent.
 */
export type RecruiterAnnotation = 'availability' | 'calcom';

/** Libellé d'une option, annoté du manque qui compte pour l'appelant. */
export function recruiterOptionLabel(
  option: RecruiterOption,
  annotate: RecruiterAnnotation,
): string {
  if (annotate === 'availability') {
    return option.hasAvailability === false
      ? `${option.displayName} (sans disponibilités)`
      : option.displayName;
  }
  return option.hasCalcomLink
    ? option.displayName
    : `${option.displayName} (sans lien Cal.com)`;
}
