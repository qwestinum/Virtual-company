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
  draftApecText,
  loadAdepState,
  publishToApec,
  transitionApec,
  type AdepState,
} from './panel-client';
import { prefillIssues, type AdepPrefill } from './prefill';
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
  /** D'où vient le texte affiché, quand il vient d'ailleurs. */
  prefill: AdepPrefill | null;
  /** Une pré-rédaction est en cours (le modèle écrit). */
  drafting: boolean;
  /** Retour neutre d'une action qui a abouti sans rien changer. */
  notice: string | null;
  /**
   * Le rapport COMPLET a tourné sur l'offre telle qu'elle est.
   *
   * ⚠️ À ne pas confondre avec « `issues` est vide » : les écarts du texte
   * pré-rempli s'affichent AVANT toute vérification, et une liste qui ne
   * contient qu'un avertissement de mise en forme ne dit rien du code INSEE ni
   * du statut du poste. Sans ce drapeau, l'écran annoncerait « prête à partir »
   * sur une offre que personne n'a validée.
   */
  verified: boolean;
  patch: (p: Partial<AdepDraftOffer>) => void;
  verify: () => void;
  publish: () => Promise<void>;
  act: (action: 'suspend' | 'republish' | 'refresh') => Promise<void>;
  /** Pré-rédige le texte. Geste explicite : jamais déclenché à l'ouverture. */
  draftText: () => Promise<void>;
};

export function useApecPanel(campaignId: string): ApecPanelState {
  const [phase, setPhase] = useState<ApecPanelState['phase']>('loading');
  const [state, setState] = useState<AdepState | null>(null);
  const [offer, setOffer] = useState<AdepDraftOffer | null>(null);
  const [issues, setIssues] = useState<AdepIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<AdepPrefill | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [verified, setVerified] = useState(false);
  /** Message NEUTRE (ni erreur ni succès bruyant) — « rien n'a changé ». */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * (Re)charge l'état complet depuis le serveur.
   *
   * Extrait de l'effet d'ouverture parce qu'une clôture de tentative change la
   * RÉFÉRENCE : la suivante porte un rang (`CAMP-2026-267-2`). Se contenter de
   * rafraîchir la ligne d'offre laisserait l'ancienne référence en en-tête,
   * juste au-dessus d'un formulaire qui n'en utilisera pas d'autre.
   */
  const reload = useCallback(async () => {
    const loaded = await loadAdepState(campaignId).catch(() => null);
    if (!loaded) {
      setPhase('absent');
      return;
    }
    setState(loaded);
    setOffer(loaded.draft);
    setPrefill(loaded.prefill ?? null);
    setIssues(loaded.prefillIssues?.length ? loaded.prefillIssues : null);
    setVerified(false);
    setPhase('ready');
  }, [campaignId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadAdepState(campaignId).catch(() => null);
      if (!alive) return;
      if (!loaded) return setPhase('absent');
      setState(loaded);
      setOffer(loaded.draft);
      setPrefill(loaded.prefill ?? null);
      // Les écarts du texte REPRIS sont montrés d'emblée — un descriptif trop
      // long se raccourcit pendant qu'on remplit le reste, pas au moment
      // d'envoyer. Le rapport COMPLET, lui, reste derrière « Vérifier » : il
      // listerait des champs que personne n'a encore eu l'occasion de saisir.
      setIssues(loaded.prefillIssues?.length ? loaded.prefillIssues : null);
      setVerified(false);
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
    setVerified(false);
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

  const verify = useCallback(() => {
    setIssues(runVerify());
    setVerified(true);
  }, [runVerify]);

  const publish = useCallback(async () => {
    if (!offer) return;
    const found = runVerify();
    setIssues(found);
    setVerified(true);
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

  /**
   * Pré-rédaction à la demande. Le texte obtenu REMPLACE le descriptif et,
   * seulement s'il est vide, l'intitulé : un titre déjà saisi est une décision,
   * l'écraser ferait perdre une correction.
   */
  const draftText = useCallback(async () => {
    if (!offer) return;
    setDrafting(true);
    setError(null);
    try {
      const drafted = await draftApecText(campaignId);
      if (!drafted) return;
      // Le texte est calculé ICI, pas dans l'updater de `setOffer` : un effet
      // de bord glissé dans une fonction de mise à jour est rejoué en
      // StrictMode, et les écarts s'afficheraient deux fois.
      const next = {
        ...offer,
        positionDescription: drafted.positionDescription,
        positionTitle: offer.positionTitle.trim() || drafted.positionTitle,
      };
      const found = prefillIssues(drafted, next);
      setPrefill(drafted);
      setOffer(next);
      setIssues(found.length > 0 ? found : null);
      setVerified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pré-rédaction impossible.');
    } finally {
      setDrafting(false);
    }
  }, [campaignId, offer]);

  const act = useCallback(
    async (action: 'suspend' | 'republish' | 'refresh') => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await transitionApec(campaignId, action);
        setState((s) => (s ? { ...s, posting: result.posting } : s));
        // Une transition peut ABOUTIR sans rien changer : l'Apec refuse
        // (fenêtre de republication fermée), ou n'est pas joignable. Sans ce
        // message, l'écran restait identique et le bouton passait pour mort.
        const outcome = result.outcome;
        if (action === 'refresh') {
          // ⚠️ « Relu, inchangé » ne se dit QUE si la lecture a eu lieu.
          // Auparavant, ce message tombait aussi sur une lecture refusée ou
          // injoignable : quelqu'un venu corriger l'identifiant Apec du
          // référent relisait, recevait la même phrase apaisante, et ne
          // pouvait pas savoir si sa correction avait pris. Un bouton de
          // diagnostic qui ne sait pas dire « ça n'a pas marché » n'est plus
          // un bouton de diagnostic.
          const read = result.read;
          if (read?.kind === 'unavailable') {
            setError(`Statut non relu — ${read.reason}`);
          } else if (read?.kind === 'not_found') {
            // Le doute levé n'est pas une mauvaise nouvelle : c'est ce qui
            // rouvre la publication. On le dit comme tel, et l'écran repasse
            // au formulaire — la tentative étant close côté serveur.
            if (read.resolved) {
              setNotice(
                'L’Apec confirme qu’aucune offre n’a été créée sous cette ' +
                  'référence. La tentative est close : vous pouvez préparer ' +
                  'une nouvelle publication.',
              );
              await reload();
            } else {
              setError(
                'L’Apec ne connaît pas cette référence, alors que l’offre a été ' +
                  'acquittée de son côté. Le statut affiché reste celui de la ' +
                  'dernière lecture : vérifiez sur apec.fr avant toute republication.',
              );
            }
          } else if (read?.kind === 'no_posting') {
            setError('Aucune offre APEC pour cette campagne.');
          } else if (result.changed === false) {
            // « Relire » qui ne change rien est un SUCCÈS, pas une panne : on
            // le dit sans crier, plutôt que de laisser l'écran muet.
            setNotice('Statut relu — il n’a pas changé.');
          }
        } else if (outcome && outcome.kind === 'refused') {
          setError(
            outcome.issues[0]?.message ??
              'L’Apec a refusé cette opération.',
          );
        } else if (outcome && outcome.kind === 'unavailable') {
          setError(outcome.reason);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action impossible.');
      } finally {
        setBusy(false);
      }
    },
    [campaignId, reload],
  );

  return {
    phase,
    state,
    offer,
    issues,
    busy,
    error,
    prefill,
    drafting,
    notice,
    verified,
    patch,
    verify,
    publish,
    act,
    draftText,
  };
}
