/**
 * Store des artefacts produits par les agents (Session 4 → étendu
 * en Session 5 round 3).
 *
 * Cycle de vie :
 *   - Round 1-2 : un artefact = un Blob mémoire téléchargeable
 *     localement, perdu au refresh.
 *   - Round 3 : chaque addArtifact pousse en async vers Supabase
 *     Storage (cf. src/lib/db/sync/artifacts-sync.ts). Le publicUrl
 *     est back-updaté quand l'upload résout. AttachmentChip préfère
 *     le publicUrl s'il est disponible, sinon retombe sur le Blob.
 *
 * Le `content` reste en mémoire pour les opérations locales (TTS,
 * download fallback). Quand l'artefact est hydraté depuis Supabase
 * au boot, content est absent — c'est attendu.
 */

import { create } from 'zustand';

import type { ArtifactKind } from '@/lib/db/types';

export type { ArtifactKind };

export type Artifact = {
  id: string;
  name: string;
  mime: string;
  /**
   * Contenu textuel local. Présent pour les artefacts produits dans
   * la session courante ; absent quand l'artefact est rehydraté
   * depuis Supabase (on n'a que la metadata + l'URL publique).
   */
  content?: string;
  createdAt: string;
  /**
   * Round 3 — appartenance (XOR) + classification.
   */
  campaignId?: string | null;
  taskId?: string | null;
  kind?: ArtifactKind;
  /**
   * Round 3 — URL Supabase Storage publique, renseignée par
   * artifacts-sync.ts après l'upload. Avant l'upload (window de
   * latence ≈100-500ms), null. AttachmentChip teste sa présence.
   */
  publicUrl?: string | null;
  storagePath?: string | null;
};

export type ArtifactInput = {
  name: string;
  mime: string;
  content: string;
  campaignId?: string | null;
  taskId?: string | null;
  kind?: ArtifactKind;
};

export type ArtifactsState = {
  byId: Record<string, Artifact>;
  addArtifact: (input: ArtifactInput) => Artifact;
  /**
   * Round 3 — appelé par artifacts-sync.ts une fois l'upload Storage
   * résolu. Idempotent : si l'artefact a été supprimé entre-temps
   * (reset chat), l'opération est un no-op.
   */
  updateArtifactStorage: (
    id: string,
    patch: { publicUrl?: string | null; storagePath?: string | null },
  ) => void;
  /**
   * Round 3 — utilisé à l'hydratation depuis Supabase pour seeder
   * des artefacts metadata-only (sans content).
   */
  hydrateArtifact: (artifact: Artifact) => void;
  getArtifact: (id: string) => Artifact | undefined;
  reset: () => void;
};

function generateId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `art_${globalThis.crypto.randomUUID()}`;
  }
  return `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useArtifactsStore = create<ArtifactsState>()((set, get) => ({
  byId: {},

  addArtifact: (input) => {
    const artifact: Artifact = {
      id: generateId(),
      name: input.name,
      mime: input.mime,
      content: input.content,
      createdAt: new Date().toISOString(),
      campaignId: input.campaignId ?? null,
      taskId: input.taskId ?? null,
      kind: input.kind,
      publicUrl: null,
      storagePath: null,
    };
    set((state) => ({
      ...state,
      byId: { ...state.byId, [artifact.id]: artifact },
    }));
    return artifact;
  },

  updateArtifactStorage: (id, patch) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            ...(patch.publicUrl !== undefined ? { publicUrl: patch.publicUrl } : {}),
            ...(patch.storagePath !== undefined ? { storagePath: patch.storagePath } : {}),
          },
        },
      };
    }),

  hydrateArtifact: (artifact) =>
    set((state) => {
      // Hydratation : ne pas écraser un artefact existant qui a déjà
      // du content (produit localement plus tard dans la même
      // session). Le content local prime sur la metadata serveur.
      const existing = state.byId[artifact.id];
      if (existing && existing.content) return state;
      return {
        ...state,
        byId: { ...state.byId, [artifact.id]: artifact },
      };
    }),

  getArtifact: (id) => get().byId[id],

  reset: () => set({ byId: {} }),
}));

/**
 * Déclenche le téléchargement navigateur d'un artefact. Crée un Blob
 * éphémère et révoque l'URL après usage pour ne pas leak.
 *
 * Round 3 : si l'artefact a un publicUrl, le navigateur peut ouvrir
 * directement l'URL ; ce helper reste utile pour le mode dégradé
 * (Supabase down) ou pour forcer un download local.
 */
export function downloadArtifact(artifact: Artifact): void {
  if (typeof window === 'undefined') return;
  if (!artifact.content) {
    // Pas de contenu local → on tente de pointer vers publicUrl.
    if (artifact.publicUrl) {
      window.open(artifact.publicUrl, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  const blob = new Blob([artifact.content], { type: artifact.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
