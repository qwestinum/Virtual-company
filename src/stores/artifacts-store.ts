/**
 * Store des artefacts produits par les agents (Session 4).
 *
 * Frontière : volatile, en mémoire seulement. La spec §5.2 prévoit un
 * storage hybride Supabase + Drive — c'est la Session 5/7. Ici on
 * conserve juste le contenu brut (string) avec des métadonnées, et on
 * matérialise un Blob à la demande pour le téléchargement.
 *
 * Cycle de vie : un artefact est créé lors d'un `dispatchJobWriter` ou
 * d'un `dispatchCVBatch`, et reste accessible tant que l'utilisateur
 * n'a pas réinitialisé le chat (`reset` est appelé en cascade).
 */

import { create } from 'zustand';

export type Artifact = {
  id: string;
  name: string;
  mime: string;
  content: string;
  createdAt: string;
};

export type ArtifactInput = {
  name: string;
  mime: string;
  content: string;
};

export type ArtifactsState = {
  byId: Record<string, Artifact>;
  addArtifact: (input: ArtifactInput) => Artifact;
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
    };
    set((state) => ({
      ...state,
      byId: { ...state.byId, [artifact.id]: artifact },
    }));
    return artifact;
  },

  getArtifact: (id) => get().byId[id],

  reset: () => set({ byId: {} }),
}));

/**
 * Déclenche le téléchargement navigateur d'un artefact. Crée un Blob
 * éphémère et révoque l'URL après usage pour ne pas leak.
 */
export function downloadArtifact(artifact: Artifact): void {
  if (typeof window === 'undefined') return;
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
