'use client';

/**
 * L'état du panneau APEC — chargement, édition, vérification, publication.
 *
 * Sorti du composant pour tenir la règle des 200 lignes, et parce que ce sont
 * des décisions plutôt que du rendu : le panneau devient une vue de cet état.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AdepOffer } from '@/types/adep';

import { completeDraft, type AdepDraftOffer, type AdepFieldNote } from './mapping';
import {
  draftApecOfferText,
  loadAdepState,
  publishToApec,
  transitionApec,
  type AdepState,
} from './panel-client';
import { checkAdepDraft } from './draft-check';
import { adepPhase } from './panel-state';
import type { AdepPrefill } from './prefill';
import type { AdepIssue } from './validate';

/**
 * Provenance d'un texte écrit par le modèle. Le libellé doit tenir dans la
 * phrase de `ApecFieldRow` (« ← déduit de …, à confirmer ») : un texte qui
 * porte sa propre ponctuation y produirait une phrase bancale.
 */
const WRITTEN_NOTE: AdepFieldNote = {
  origin: 'derived',
  from: 'la fiche de poste (rédigé par le modèle)',
};

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
  /**
   * `error` = le chargement a échoué. Le panneau RESTE à l'écran et dit
   * pourquoi — il ne s'efface jamais en silence (cf. `loadAdepState`).
   */
  phase: 'loading' | 'error' | 'ready';
  state: AdepState | null;
  offer: AdepDraftOffer | null;
  issues: AdepIssue[] | null;
  busy: boolean;
  error: string | null;
  /**
   * Provenances des champs, celle du profil COMPRISE.
   *
   * ⚠️ À utiliser plutôt que `state.notes` : le profil est rédigé côté client
   * après le chargement, et la note du serveur (« compétences clés ») ne dirait
   * plus d'où vient le texte affiché.
   */
  notes: Partial<Record<keyof AdepOffer, AdepFieldNote>>;
  /** D'où vient le texte affiché, quand il vient d'ailleurs. */
  prefill: AdepPrefill | null;
  /**
   * Quel(s) texte(s) le modèle est en train de rédiger — `null` sinon.
   * `both` = la rédaction automatique de l'ouverture.
   */
  textDrafting: 'description' | 'profile' | 'both' | null;
  /**
   * La rédaction n'a pas abouti. LOCAL aux champs : le panneau reste utilisable
   * et garde le report des listes de la fiche — des textes non rédigés ne sont
   * pas une panne du panneau.
   */
  textError: string | null;
  /**
   * Redemande un texte au modèle, depuis le descriptif AFFICHÉ. `target`
   * désigne le champ à remplacer : l'autre garde ce qu'il a.
   */
  draftOfferText: (target: 'description' | 'profile') => Promise<void>;
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
  /** Recharge tout l'état. Offert à l'écran quand le chargement a échoué. */
  reload: () => Promise<void>;
};

export function useApecPanel(campaignId: string): ApecPanelState {
  const [phase, setPhase] = useState<ApecPanelState['phase']>('loading');
  const [state, setState] = useState<AdepState | null>(null);
  const [offer, setOffer] = useState<AdepDraftOffer | null>(null);
  const [issues, setIssues] = useState<AdepIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<AdepPrefill | null>(null);
  const [textDrafting, setTextDrafting] =
    useState<ApecPanelState['textDrafting']>(null);
  const [textError, setTextError] = useState<string | null>(null);
  /** Notes LOCALES des deux textes, posées quand le modèle les a écrits. */
  const [writtenNotes, setWrittenNotes] = useState<{
    positionDescription?: AdepFieldNote;
    profileDescription?: AdepFieldNote;
  }>({});
  /**
   * Le recruteur a touché à un champ : sa saisie est une DÉCISION, une
   * rédaction encore en vol ne doit jamais l'écraser.
   */
  const touchedRef = useRef({ description: false, profile: false });
  /** Une rédaction a déjà été demandée pour ce panneau (garde StrictMode). */
  const textRequestedRef = useRef(false);
  const [verified, setVerified] = useState(false);
  /** Message NEUTRE (ni erreur ni succès bruyant) — « rien n'a changé ». */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Demande les deux textes au modèle et applique CEUX QU'ON VEUT.
   *
   * `apply` dit quels champs remplacer : à l'ouverture, le profil toujours et
   * le descriptif seulement s'il n'était qu'un report de la fiche — réécrire un
   * texte relu par un humain demande un geste. Depuis un bouton, un seul champ,
   * celui qu'on a désigné.
   *
   * `respectTouched` : l'appel AUTOMATIQUE abandonne un champ où le recruteur a
   * écrit pendant que le modèle rédigeait — sa saisie est une décision. L'appel
   * MANUEL applique toujours : c'est lui qui l'a demandé.
   */
  const runTextDraft = useCallback(
    async (
      source: string,
      apply: { description: boolean; profile: boolean },
      respectTouched: boolean,
    ) => {
      setTextDrafting(
        apply.description && apply.profile
          ? 'both'
          : apply.description
            ? 'description'
            : 'profile',
      );
      setTextError(null);
      try {
        const drafted = await draftApecOfferText(campaignId, source);
        const takeDescription =
          apply.description && !(respectTouched && touchedRef.current.description);
        const takeProfile =
          apply.profile && !(respectTouched && touchedRef.current.profile);
        if (!takeDescription && !takeProfile) return;
        setOffer((current) =>
          current
            ? {
                ...current,
                ...(takeDescription
                  ? { positionDescription: drafted.positionDescription }
                  : {}),
                ...(takeProfile
                  ? { profileDescription: drafted.profileDescription }
                  : {}),
              }
            : current,
        );
        setWrittenNotes((current) => ({
          ...current,
          ...(takeDescription ? { positionDescription: WRITTEN_NOTE } : {}),
          ...(takeProfile ? { profileDescription: WRITTEN_NOTE } : {}),
        }));
        // Les champs remplacés ne sont plus « touchés » par personne : ces
        // textes-ci viennent d'arriver, une rédaction ultérieure peut les
        // écraser.
        if (takeDescription) touchedRef.current.description = false;
        if (takeProfile) touchedRef.current.profile = false;
        // Le texte a changé : un rapport de vérification devient périmé.
        setIssues(null);
        setVerified(false);
      } catch (err) {
        setTextError(
          err instanceof Error ? err.message : 'Rédaction des textes impossible.',
        );
      } finally {
        setTextDrafting(null);
      }
    },
    [campaignId],
  );

  /**
   * Les textes se rédigent-ils pour cet état ? Non quand l'offre est déjà
   * partie chez l'Apec : le formulaire n'est même pas à l'écran (le contenu est
   * figé à la publication), et appeler le modèle pour des champs invisibles
   * serait payer pour rien.
   */
  const shouldDraftText = (loaded: AdepState): boolean =>
    adepPhase(loaded.posting) === 'none' || adepPhase(loaded.posting) === 'failed';

  /**
   * Le descriptif chargé n'est-il qu'un REPORT de la fiche ? Alors le modèle
   * peut le réécrire d'office. S'il vient d'une annonce (relue) ou d'un
   * brouillon demandé, on n'y touche pas sans geste explicite.
   */
  const descriptionIsReport = (loaded: AdepState): boolean =>
    loaded.prefill === null;

  const draftOfferText = useCallback(
    async (target: 'description' | 'profile') => {
      if (!offer) return;
      await runTextDraft(
        offer.positionDescription,
        { description: target === 'description', profile: target === 'profile' },
        false,
      );
    },
    [offer, runTextDraft],
  );

  /**
   * (Re)charge l'état complet depuis le serveur.
   *
   * Extrait de l'effet d'ouverture parce qu'une clôture de tentative change la
   * RÉFÉRENCE : la suivante porte un rang (`CAMP-2026-267-2`). Se contenter de
   * rafraîchir la ligne d'offre laisserait l'ancienne référence en en-tête,
   * juste au-dessus d'un formulaire qui n'en utilisera pas d'autre.
   */
  const reload = useCallback(async () => {
    try {
      const loaded = await loadAdepState(campaignId);
      setState(loaded);
      setOffer(loaded.draft);
      setPrefill(loaded.prefill ?? null);
      // Les écarts du texte REPRIS sont montrés d'emblée — un descriptif trop
      // long se raccourcit pendant qu'on remplit le reste, pas au moment
      // d'envoyer. Le rapport COMPLET, lui, reste derrière « Vérifier » : il
      // listerait des champs que personne n'a encore eu l'occasion de saisir.
      setIssues(loaded.prefillIssues?.length ? loaded.prefillIssues : null);
      setVerified(false);
      setError(null);
      setPhase('ready');
      // Un rechargement remplace le formulaire par le brouillon du serveur :
      // les textes rédigés disparaissent avec le reste. On efface donc leurs
      // notes (elles parleraient de textes qui ne sont plus là) et on redemande.
      setWrittenNotes({});
      setTextError(null);
      touchedRef.current = { description: false, profile: false };
      if (shouldDraftText(loaded)) {
        void runTextDraft(
          loaded.draft.positionDescription,
          { description: descriptionIsReport(loaded), profile: true },
          true,
        );
      }
    } catch (err) {
      // ⚠️ On ne retire PAS le panneau : il disparaîtrait, et activer le canal
      // APEC n'aurait aucun effet visible. On reste à l'écran, et on dit quoi.
      setError(err instanceof Error ? err.message : 'Panneau APEC indisponible.');
      setPhase('error');
    }
  }, [campaignId, runTextDraft]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loaded = await loadAdepState(campaignId);
        if (!alive) return;
        setState(loaded);
        setOffer(loaded.draft);
        setPrefill(loaded.prefill ?? null);
        setIssues(loaded.prefillIssues?.length ? loaded.prefillIssues : null);
        setVerified(false);
        setPhase('ready');
        // Les textes sont rédigés DÈS L'OUVERTURE (décision du donneur
        // d'ordre) : le recruteur les trouve écrits et les ajuste avant de
        // publier. Le drapeau garantit UN appel par panneau — en
        // développement React rejoue les effets, et sans lui le modèle serait
        // sollicité deux fois. Le descriptif n'est réécrit que s'il n'était
        // qu'un report de la fiche : une annonce relue ne se réécrit pas
        // toute seule.
        if (!textRequestedRef.current && shouldDraftText(loaded)) {
          textRequestedRef.current = true;
          void runTextDraft(
            loaded.draft.positionDescription,
            { description: descriptionIsReport(loaded), profile: true },
            true,
          );
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Panneau APEC indisponible.');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [campaignId, runTextDraft]);

  const patch = useCallback((p: Partial<AdepDraftOffer>) => {
    // Une frappe dans un texte est une décision : elle coupe court à une
    // rédaction encore en vol (cf. `runTextDraft`).
    if (p.positionDescription !== undefined) touchedRef.current.description = true;
    if (p.profileDescription !== undefined) touchedRef.current.profile = true;
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

  // Champ par champ : un « certains champs manquent » laissait deviner lesquels.
  const runVerify = useCallback(
    (): AdepIssue[] => (offer ? checkAdepDraft(offer, todayInParis()) : []),
    [offer],
  );

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

  // Les notes des textes RÉDIGÉS priment sur celles du serveur : c'est la
  // provenance de ce qui est réellement affiché.
  const notes = useMemo(
    () => ({ ...(state?.notes ?? {}), ...writtenNotes }),
    [state?.notes, writtenNotes],
  );

  return {
    phase,
    state,
    offer,
    issues,
    busy,
    error,
    notes,
    prefill,
    textDrafting,
    textError,
    draftOfferText,
    notice,
    verified,
    patch,
    verify,
    publish,
    act,
    reload,
  };
}
