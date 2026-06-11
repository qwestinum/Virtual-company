/**
 * Store Zustand de la FILE D'UPLOAD du vivier (Session V1).
 *
 * La file de traitement reste visible et survit au changement d'onglet
 * (Upload ↔ Liste) au sein de la page vivier. L'indexation elle-même se
 * poursuit côté serveur (after()) même si l'utilisateur quitte la page : ce
 * store ne pilote QUE l'affichage de l'état d'upload côté client.
 */

import { create } from 'zustand';

export type VivierUploadStatus =
  | 'extracting' // envoi + extraction côté serveur en cours
  | 'queued' // dossier créé/mis à jour, indexation planifiée
  | 'duplicate' // doublon intra-lot (a mis à jour un dossier déjà traité dans ce lot)
  | 'unsupported' // format non pris en charge (DOCX…)
  | 'error'; // échec (illisible, email manquant, erreur serveur)

export type VivierUploadItem = {
  key: string;
  name: string;
  status: VivierUploadStatus;
  message: string | null;
  candidateId: string | null;
  email: string | null;
};

export type VivierUploadState = {
  uploads: VivierUploadItem[];
  enqueue: (items: VivierUploadItem[]) => void;
  patch: (key: string, partial: Partial<VivierUploadItem>) => void;
  clear: () => void;
};

export const useVivierUploadStore = create<VivierUploadState>()((set) => ({
  uploads: [],
  enqueue: (items) =>
    set((state) => ({ uploads: [...items, ...state.uploads] })),
  patch: (key, partial) =>
    set((state) => ({
      uploads: state.uploads.map((u) =>
        u.key === key ? { ...u, ...partial } : u,
      ),
    })),
  clear: () => set({ uploads: [] }),
}));
