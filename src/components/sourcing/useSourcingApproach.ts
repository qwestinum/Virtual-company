'use client';

/**
 * L'approche d'un profil : préparer (le modèle rédige), relire, confirmer.
 *
 * ⚠️ L'ÉTAT EXISTE DÈS LE CLIC (22/09/2026). Avant, rien n'existait tant que
 * le serveur n'avait pas répondu : la fenêtre n'apparaissait qu'après
 * plusieurs secondes, et un changement de format la REFERMAIT le temps de la
 * nouvelle rédaction. Ici la fenêtre s'ouvre au clic (`attente`), le format
 * demandé est retenu tout de suite (`format`), et l'ancien message reste
 * affiché jusqu'à ce que le nouveau arrive.
 *
 * ⚠️ UNE RÉPONSE PÉRIMÉE NE S'AFFICHE JAMAIS. Deux changements de format
 * rapprochés lancent deux rédactions ; seule la DERNIÈRE compte (`jeton`).
 * Une rédaction arrivée après la fermeture ou après une plus récente a
 * pourtant créé une approche côté serveur : elle est ANNULÉE, sinon elle
 * resterait en suspens avec un lien émis que personne n'a vu.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { SourcingProfileView } from '@/types/sourcing';

import type { PreparedApproach } from './SourcingApproachPanel';

export type ApproachFormat = 'connection_note' | 'inmail';

export type ApproachState = {
  profileId: string;
  channel: 'linkedin' | 'email';
  /** Le format DEMANDÉ — coché avant même que la rédaction revienne. */
  format: ApproachFormat | null;
  /** Le dernier message rédigé ; `null` tant que le premier n'est pas là. */
  prepared: PreparedApproach | null;
  attente: boolean;
  erreur: string | null;
};

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const annulerCote = (approachId: string) =>
  void post(`/api/sourcing/approaches/${approachId}`, { action: 'cancel' }).catch(() => null);

export function useSourcingApproach() {
  const [approche, setApproche] = useState<ApproachState | null>(null);
  const jeton = useRef(0);
  // Lu dans les rappels sans les recréer à chaque rendu.
  const courante = useRef<ApproachState | null>(null);
  useLayoutEffect(() => {
    courante.current = approche;
  }, [approche]);

  const preparer = useCallback(
    async (p: SourcingProfileView, channel: 'linkedin' | 'email', format?: ApproachFormat) => {
      const n = ++jeton.current;
      setApproche((a) => ({
        profileId: p.id,
        channel,
        format: format ?? null,
        // On garde le message précédent du MÊME profil pendant la rédaction.
        prepared: a && a.profileId === p.id ? a.prepared : null,
        attente: true,
        erreur: null,
      }));
      const res = await post(`/api/sourcing/profiles/${p.id}/approaches`, {
        channel,
        ...(format ? { format } : {}),
      }).catch(() => null);
      const json = res
        ? ((await res.json().catch(() => ({}))) as PreparedApproach & { message?: string })
        : null;
      if (n !== jeton.current) {
        if (res?.ok && json?.approachId) annulerCote(json.approachId);
        return;
      }
      if (!res?.ok || !json?.approachId) {
        // ⚠️ `prepared: null` : après un changement de format, l'approche
        // affichée a DÉJÀ été annulée côté serveur — la laisser à l'écran
        // permettrait de confirmer une approche morte.
        setApproche((a) =>
          a
            ? { ...a, prepared: null, attente: false, erreur: json?.message ?? 'Le message n’a pas pu être préparé.' }
            : a,
        );
        return;
      }
      setApproche({ profileId: p.id, channel, format: null, prepared: json, attente: false, erreur: null });
    },
    [],
  );

  /** Change de format SANS fermer : l'ancienne approche est annulée en parallèle. */
  const changerFormat = useCallback(
    (p: SourcingProfileView, format: ApproachFormat) => {
      const ancienne = courante.current?.prepared;
      if (ancienne) annulerCote(ancienne.approachId);
      void preparer(p, 'linkedin', format);
    },
    [preparer],
  );

  const fermer = useCallback(() => {
    jeton.current++;
    const prepared = courante.current?.prepared;
    if (prepared) annulerCote(prepared.approachId);
    setApproche(null);
  }, []);

  const confirmer = useCallback(async (message: string): Promise<string | null> => {
    const prepared = courante.current?.prepared;
    if (!prepared) return null;
    const res = await post(`/api/sourcing/approaches/${prepared.approachId}`, {
      action: 'confirm',
      message,
      url: prepared.url,
    }).catch(() => null);
    if (res?.ok) return null;
    const json = res ? ((await res.json().catch(() => ({}))) as { message?: string }) : null;
    return json?.message ?? 'L’approche n’a pas pu être enregistrée.';
  }, []);

  return { approche, preparer, changerFormat, fermer, confirmer };
}
