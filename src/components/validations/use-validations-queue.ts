'use client';

/**
 * Chargement de la file « Validation suspendue » — le VOLET DONNÉES du hub,
 * extrait pour que le composant reste lisible (règle des 200 lignes).
 *
 * Une seule requête sert tout ce dont la page a besoin : la file, la zone
 * figée au scoring de chaque dossier, le référent de chaque campagne présente
 * et l'identité du lecteur (raccourci « Mes campagnes »). Aucun fetch par
 * carte, ni ici ni ailleurs.
 *
 * L'historique (`status=sent`) reste chargé À LA DEMANDE, best-effort : c'est
 * une consultation, jamais une donnée dont dépend une décision.
 */

import { useEffect, useState } from 'react';

import { hydrateArtifactsForCampaign } from '@/lib/db/sync/artifacts-sync';
import type { ReferentByCampaign } from '@/lib/referent/filter';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

export type QueueState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: PendingValidation[] }
  | { kind: 'error'; message: string };

export function useValidationsQueue() {
  const [state, setState] = useState<QueueState>({ kind: 'loading' });
  // Zone FIGÉE AU SCORING de chaque validation. C'est elle qui décide du
  // sous-onglet — jamais une comparaison du score au seuil COURANT de la
  // campagne, qui re-jugerait un dossier avec un barème qu'il n'a jamais
  // connu (cf. rejection-proposal.ts).
  const [zones, setZones] = useState<Record<string, DecisionZone | null>>({});
  const [referents, setReferents] = useState<ReferentByCampaign>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<PendingValidation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          validations: PendingValidation[];
          zoneByValidation?: Record<string, DecisionZone | null>;
          referentByCampaign?: ReferentByCampaign;
          currentUserId?: string | null;
        };
        if (!cancelled) {
          setState({ kind: 'ready', items: json.validations });
          setZones(json.zoneByValidation ?? {});
          // Enrichissements ABSENTS = dégradation douce : aucun référent
          // connu, pas de raccourci « Mes campagnes ». La file, elle, reste
          // entière et actionnable.
          setReferents(json.referentByCampaign ?? {});
          setCurrentUserId(json.currentUserId ?? null);
        }
        const campaigns = [
          ...new Set(json.validations.map((v) => v.campaignId)),
        ];
        await Promise.all(campaigns.map((c) => hydrateArtifactsForCampaign(c)));
      } catch (err) {
        if (!cancelled)
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'load_failed',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadHistory = async () => {
    if (history.length > 0) return;
    try {
      const res = await fetch('/api/validations?status=sent', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = (await res.json()) as { validations: PendingValidation[] };
        setHistory(json.validations);
      }
    } catch {
      // historique best-effort
    }
  };

  /**
   * Une candidature tranchée quitte la file et rejoint l'historique local.
   * Les mutations de la file vivent ICI, avec le chargement : le hub n'a plus
   * de raison de manipuler `setState`, il ne fait qu'afficher.
   */
  const applySent = (v: PendingValidation) => {
    setState((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', items: prev.items.filter((it) => it.id !== v.id) }
        : prev,
    );
    setHistory((h) => [{ ...v, status: 'sent' }, ...h]);
  };

  /**
   * Retire les validations traitées par une fournée — celles qui ont ABOUTI
   * seulement : les échecs restent `pending`, donc restent visibles et
   * retentables.
   */
  const applyBatchDone = (treatedIds: readonly string[]) => {
    const treated = new Set(treatedIds);
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      setHistory((h) => [
        ...prev.items
          .filter((it) => treated.has(it.id))
          .map((it) => ({
            ...it,
            status: 'sent' as const,
            decision: 'reject' as const,
          })),
        ...h,
      ]);
      return {
        kind: 'ready',
        items: prev.items.filter((it) => !treated.has(it.id)),
      };
    });
  };

  return {
    state,
    zones,
    referents,
    currentUserId,
    history,
    loadHistory,
    applySent,
    applyBatchDone,
  };
}
