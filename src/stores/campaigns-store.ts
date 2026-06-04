/**
 * Store des campagnes actives (Session 4 — volatile).
 *
 * Une « campagne active » = une FDP validée, encore ouverte (non
 * clôturée). Conservée en mémoire seulement, pour permettre le routing
 * d'un upload CV vers une campagne existante. La persistance arrive
 * en Session 5/7 avec le storage hybride Supabase + Drive.
 *
 * Frontière : les campagnes sont alimentées par `validateFDP()` côté
 * ManagerChat (pas d'auto-watch sur fdp-store pour rester explicite).
 */

import { create } from 'zustand';

import {
  deriveActiveStatus,
  reconcileLifecycle,
} from '@/lib/campaign/lifecycle';
import type { CampaignLifecycle } from '@/types/campaign-lifecycle';
import type { CampaignStatus } from '@/types/campaign-status';
import type { CVSource } from '@/types/cv-source';
import type { FDPInProgress } from '@/types/field-collection';
import type { PublicationChannel } from '@/types/publication-channel';
import type { ScoringSheet } from '@/types/scoring';

export type ActiveCampaign = {
  id: string; // CAMP-XXXX
  name: string; // intitulé du poste, ou nom donné explicitement
  fdp: FDPInProgress; // snapshot de la FDP au moment de l'archivage
  /**
   * Phase 5.2 — snapshot de la fiche de scoring associée à cette
   * campagne, si elle a été produite. Restaurée au switch pour
   * permettre au DRH de reprendre où il s'est arrêté.
   */
  scoringSheet: ScoringSheet | null;
  /**
   * Phase 7.1 — tracking des artefacts produits pour cette campagne.
   * Sert à recomputeStatus qui dérive 'active' uniquement quand TOUT
   * est aligné (FDP validée + au moins une annonce + flux confirmés
   * + scoring validé). Avant Phase 7, le status pouvait passer à
   * 'active' juste sur validation scoring même si la FDP ou les flux
   * n'étaient pas en place.
   */
  publishedChannels: PublicationChannel[];
  sourcesConfirmed: boolean;
  /**
   * Session 6 v3 — flux de réception des CV actifs pour cette campagne.
   * Distinct des `publishedChannels` (où l'annonce est diffusée) — un
   * flux = un canal d'arrivée (manual, email, scraping LinkedIn…). Le
   * DRH édite ces flux via le bloc Flux du sheet d'édition campagne.
   */
  sources: CVSource[];
  /**
   * Session 6 — seuil d'acceptation 0..100 utilisé par le CV Analyzer
   * pour décider `aboveThreshold`. Ajustable depuis le dashboard
   * (slider). Default 75 (cohérent avec DEFAULT_CV_THRESHOLD).
   * Le changement ne recompute pas rétroactivement les candidats déjà
   * analysés — le nouveau seuil s'applique aux prochaines analyses.
   */
  threshold: number;
  /**
   * Phase 5.1 — état d'avancement de la campagne. Dérivé par
   * recomputeStatus quand un jalon change, ou écrasé explicitement
   * par updateStatus (closed, paused).
   */
  status: CampaignStatus;
  /**
   * Inc. 2a — machine d'états des phases (source de vérité du déroulé).
   * Tenue à jour par les mutations de jalon (addCampaign / markPublished /
   * markSources) via `reconcileLifecycle`. `status` en est dérivé. Volatile
   * (non persistée pour l'instant — re-dérivée des artefacts au chargement).
   */
  lifecycle: CampaignLifecycle;
  createdAt: string;
  updatedAt: string;
};

export type CampaignsState = {
  byId: Record<string, ActiveCampaign>;
  order: string[];

  addCampaign: (input: {
    fdp: FDPInProgress;
    name?: string;
    status?: CampaignStatus;
    scoringSheet?: ScoringSheet | null;
    publishedChannels?: PublicationChannel[];
    sourcesConfirmed?: boolean;
    sources?: CVSource[];
    threshold?: number;
  }) => ActiveCampaign;
  /**
   * Session 6 — ajuste le seuil d'acceptation d'une campagne. Le
   * Manager prend acte en parallèle dans le chat (cf.
   * pushManagerAcknowledgment). Aucun recompute rétroactif des
   * candidats déjà analysés (cf. ActiveCampaign.threshold).
   */
  setThreshold: (id: string, threshold: number) => void;
  /**
   * Session 6 v3 — remplace la liste des sources actives d'une
   * campagne. Le bloc Flux passe la liste complète (additive vs
   * substractive) pour rester explicite côté UI.
   */
  setSources: (id: string, sources: CVSource[]) => void;
  /**
   * Écrase explicitement le statut d'une campagne (paused / closed
   * principalement). Pour les transitions dérivées (draft → in_progress
   * → active), utiliser recomputeStatus.
   */
  updateStatus: (id: string, status: CampaignStatus) => void;
  /**
   * Phase 7.1 — marque qu'une annonce a été produite pour ce channel.
   * Idempotent (pas de doublon). Recalcule le statut après.
   */
  markPublishedChannel: (id: string, channel: PublicationChannel) => void;
  /**
   * Phase 7.1 — marque que le cv-sources-picker a été confirmé.
   * Recalcule le statut après.
   */
  markSourcesConfirmed: (id: string) => void;
  /**
   * Phase 7.1 — recalcule le status DÉRIVÉ d'une campagne à partir de
   * ses artefacts. Règle :
   *   - FDP non validée → 'draft'
   *   - FDP validée mais (annonce manquante OR flux non confirmés OR
   *     scoring non validé) → 'in_progress'
   *   - Tout aligné → 'active'
   * Ne touche PAS aux statuts explicites 'paused' et 'closed' — un
   * recompute ne sort jamais quelqu'un de la pause ou de la clôture.
   */
  recomputeStatus: (id: string) => void;
  getById: (id: string) => ActiveCampaign | undefined;
  list: () => ActiveCampaign[];
  reset: () => void;
};

function jobTitleFromFDP(fdp: FDPInProgress): string {
  const v = fdp.fields.job_title?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return 'Poste non précisé';
}

/** Projette les artefacts d'une campagne en booléens pour la machine. */
function artifactBooleans(input: {
  fdp: FDPInProgress;
  scoringSheet: ScoringSheet | null;
  sourcesConfirmed: boolean;
  publishedChannels: PublicationChannel[];
}) {
  return {
    fdpValidated: input.fdp.isValidated,
    scoringValidated: input.scoringSheet?.isValidated === true,
    scoringStarted: input.scoringSheet != null,
    sourcesConfirmed: input.sourcesConfirmed,
    hasPublishedChannel: input.publishedChannels.length > 0,
  };
}

/**
 * Inc. 2a — réconcilie la machine STOCKÉE d'une campagne avec ses artefacts
 * courants (préserve les `postponed`/`in_progress` explicites). À appeler
 * dans toute mutation de jalon avant d'écrire la campagne.
 */
function syncLifecycle(input: {
  fdp: FDPInProgress;
  scoringSheet: ScoringSheet | null;
  sourcesConfirmed: boolean;
  publishedChannels: PublicationChannel[];
  lifecycle?: CampaignLifecycle;
}): CampaignLifecycle {
  return reconcileLifecycle(input.lifecycle ?? null, artifactBooleans(input));
}

export const useCampaignsStore = create<CampaignsState>()((set, get) => ({
  byId: {},
  order: [],

  addCampaign: (input) => {
    const name = input.name?.trim() || jobTitleFromFDP(input.fdp);
    const now = new Date().toISOString();
    // Si une entrée existe déjà avec cet id, on préserve son status
    // courant (ne le redescend pas à 'in_progress' alors qu'elle est
    // peut-être déjà 'active' / 'closed').
    const existing = get().byId[input.fdp.campaignId];
    // (lifecycle/status calculés plus bas, une fois scoringSheet etc. résolus)
    // Le snapshot de scoring du caller prime ; sinon on garde l'existant
    // (on évite de l'effacer accidentellement quand un addCampaign
    // ultérieur ne porte que la FDP).
    const scoringSheet =
      input.scoringSheet !== undefined
        ? input.scoringSheet
        : (existing?.scoringSheet ?? null);
    const publishedChannels =
      input.publishedChannels ?? existing?.publishedChannels ?? [];
    const sourcesConfirmed =
      input.sourcesConfirmed ?? existing?.sourcesConfirmed ?? false;
    const sources =
      input.sources ?? existing?.sources ?? ['manual'];
    const threshold =
      input.threshold ?? existing?.threshold ?? 75;
    const lifecycle = syncLifecycle({
      fdp: input.fdp,
      scoringSheet,
      sourcesConfirmed,
      publishedChannels,
      lifecycle: existing?.lifecycle,
    });
    // Statut : surcharge explicite > statut existant préservé > dérivé.
    const status =
      input.status ?? existing?.status ?? deriveActiveStatus(lifecycle);
    const campaign: ActiveCampaign = {
      id: input.fdp.campaignId,
      name,
      fdp: input.fdp,
      scoringSheet,
      publishedChannels,
      sourcesConfirmed,
      sources,
      threshold,
      status,
      lifecycle,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    set((state) => {
      const exists = Boolean(state.byId[campaign.id]);
      const order = exists ? state.order : [...state.order, campaign.id];
      return {
        ...state,
        byId: { ...state.byId, [campaign.id]: campaign },
        order,
      };
    });
    return campaign;
  },

  updateStatus: (id, status) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            status,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  setThreshold: (id, threshold) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      const clamped = Math.max(0, Math.min(100, Math.round(threshold)));
      if (clamped === current.threshold) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            threshold: clamped,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  setSources: (id, sources) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      // Déduplique en préservant l'ordre.
      const seen = new Set<string>();
      const deduped: typeof current.sources = [];
      for (const s of sources) {
        if (!seen.has(s)) {
          seen.add(s);
          deduped.push(s);
        }
      }
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            sources: deduped,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  markPublishedChannel: (id, channel) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      if (current.publishedChannels.includes(channel)) return state;
      const publishedChannels = [...current.publishedChannels, channel];
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            publishedChannels,
            lifecycle: syncLifecycle({ ...current, publishedChannels }),
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  markSourcesConfirmed: (id) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      if (current.sourcesConfirmed) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            sourcesConfirmed: true,
            lifecycle: syncLifecycle({ ...current, sourcesConfirmed: true }),
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  recomputeStatus: (id) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      // Les statuts explicites paused / closed ne sont jamais
      // écrasés par un recompute — seul l'utilisateur les change.
      if (current.status === 'paused' || current.status === 'closed') {
        return state;
      }
      // Statut DÉRIVÉ de la machine d'états stockée (Inc. 2a). Le lifecycle
      // est tenu à jour par les mutations de jalon ; ici on ne fait que
      // dériver. Une seule source de vérité.
      const nextStatus = deriveActiveStatus(current.lifecycle);
      if (nextStatus === current.status) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            status: nextStatus,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  getById: (id) => get().byId[id],

  list: () => {
    const { order, byId } = get();
    return order
      .map((id) => byId[id])
      .filter((c): c is ActiveCampaign => Boolean(c));
  },

  reset: () => set({ byId: {}, order: [] }),
}));

export const selectActiveCampaigns = (
  state: CampaignsState,
): ActiveCampaign[] =>
  state.order
    .map((id) => state.byId[id])
    .filter((c): c is ActiveCampaign => Boolean(c));
