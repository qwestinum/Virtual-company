'use client';

/**
 * L'état du panneau APEC — chargement, édition, vérification, publication.
 *
 * Sorti du composant pour tenir la règle des 200 lignes, et parce que ce sont
 * des décisions plutôt que du rendu : le panneau devient une vue de cet état.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { completeDraft, type AdepDraftOffer } from './mapping';
import {
  loadAdepState,
  publishToApec,
  transitionApec,
  type AdepState,
} from './panel-client';
import { validateAdepOffer, type AdepIssue } from './validate';

/** Jour courant, fuseau France — les règles de date de l'Apec sont civiles. */
function todayInParis(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export type ApecPanelState = {
  phase: 'loading' | 'absent' | 'ready';
  state: AdepState | null;
  offer: AdepDraftOffer | null;
  issues: AdepIssue[] | null;
  busy: boolean;
  error: string | null;
  patch: (p: Partial<AdepDraftOffer>) => void;
  verify: () => void;
  publish: () => Promise<void>;
  act: (action: 'suspend' | 'republish' | 'refresh') => Promise<void>;
};

export function useApecPanel(campaignId: string): ApecPanelState {
  const [phase, setPhase] = useState<ApecPanelState['phase']>('loading');
  const [state, setState] = useState<AdepState | null>(null);
  const [offer, setOffer] = useState<AdepDraftOffer | null>(null);
  const [issues, setIssues] = useState<AdepIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadAdepState(campaignId).catch(() => null);
      if (!alive) return;
      if (!loaded) return setPhase('absent');
      setState(loaded);
      setOffer(loaded.draft);
      setPhase('ready');
    })();
    return () => {
      alive = false;
    };
  }, [campaignId]);

  const patch = useCallback((p: Partial<AdepDraftOffer>) => {
    setOffer((current) => (current ? { ...current, ...p } : current));
    // Un rapport devient périmé dès la première frappe : le garder afficherait
    // des erreurs déjà corrigées.
    setIssues(null);
  }, []);

  const complete = useMemo(
    () => (offer ? completeDraft(offer, 'preview') : null),
    [offer],
  );

  const runVerify = useCallback((): AdepIssue[] => {
    if (!complete) {
      return [
        {
          level: 'error',
          field: 'draft',
          message: 'Certains champs demandés par l’Apec ne sont pas encore renseignés.',
          preventsCode: '023',
        },
      ];
    }
    const report = validateAdepOffer(complete, todayInParis());
    return [...report.errors, ...report.warnings];
  }, [complete]);

  const verify = useCallback(() => setIssues(runVerify()), [runVerify]);

  const publish = useCallback(async () => {
    if (!offer) return;
    const found = runVerify();
    setIssues(found);
    if (found.some((i) => i.level === 'error') || !complete) return;

    setBusy(true);
    setError(null);
    try {
      // On envoie l'offre RELUE. La référence et l'identifiant de transaction
      // sont posés par le SERVEUR : les laisser au client permettrait de
      // rejouer une référence, donc de contourner le verrou d'idempotence.
      const { clientPositionId: _ref, trackingId: _trk, ...payload } = complete;
      const result = await publishToApec(campaignId, payload);
      setState((s) => (s ? { ...s, posting: result.posting } : s));
      if (result.outcome.kind === 'rejected') {
        setIssues(
          result.outcome.issues.map((i) => ({
            level: i.blocking ? ('error' as const) : ('warning' as const),
            field: i.field ?? 'offre',
            message: i.message,
            preventsCode: i.code ?? '—',
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publication impossible.');
    } finally {
      setBusy(false);
    }
  }, [campaignId, complete, offer, runVerify]);

  const act = useCallback(
    async (action: 'suspend' | 'republish' | 'refresh') => {
      setBusy(true);
      setError(null);
      try {
        const result = await transitionApec(campaignId, action);
        setState((s) => (s ? { ...s, posting: result.posting } : s));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action impossible.');
      } finally {
        setBusy(false);
      }
    },
    [campaignId],
  );

  return { phase, state, offer, issues, busy, error, patch, verify, publish, act };
}
