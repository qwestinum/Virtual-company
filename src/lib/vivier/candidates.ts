/**
 * Création / mise à jour / suppression d'un dossier vivier (Session V1).
 *
 * Orchestration au-dessus du repo (`@/lib/db/repos/vivier`) et du Storage
 * (`@/lib/storage/blob`) :
 *   - `upsertVivierCandidate` : déduplication par email NORMALISÉ. Email connu
 *     ⇒ mise à jour du dossier (nouveau CV au Storage, ancien fichier supprimé,
 *     statut repassé `pending`). Email inconnu ⇒ création.
 *   - `deleteVivierCandidate` : suppression cascade (fichier Storage + dossier ;
 *     embedding/entités purgés par le `on delete cascade` côté base) avec trace
 *     ANONYMISÉE au journal (aucune donnée personnelle), cf. RGPD §8.2.
 *
 * Server-only. Le déclenchement de l'indexation (asynchrone) est de la
 * responsabilité de l'appelant (route), pas de ce module.
 */

import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  deleteVivierCandidateRow,
  getVivierCandidate,
  getVivierCandidateByEmail,
  insertVivierCandidate,
  updateVivierCandidateCV,
} from '@/lib/db/repos/vivier';
import { deleteArtifact, uploadArtifactBinary } from '@/lib/storage/blob';
import type { VivierCandidate, VivierSource } from '@/types/vivier';

/**
 * Normalise un email pour la déduplication : trim + minuscules. Pure et
 * déterministe (exportée pour test). La contrainte unique de la base s'applique
 * sur cette forme normalisée.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const VIVIER_ID_TAKEN = new Set<string>();

/** Génère un identifiant `VIV-XXXX`. Même esprit que `generateCampaignId`. */
export function generateVivierId(takenIds: Iterable<string> = []): string {
  for (const id of takenIds) VIVIER_ID_TAKEN.add(id);
  for (let attempt = 0; attempt < 50; attempt++) {
    const n = Math.floor(Math.random() * 9999) + 1;
    const id = `VIV-${String(n).padStart(4, '0')}`;
    if (!VIVIER_ID_TAKEN.has(id)) {
      VIVIER_ID_TAKEN.add(id);
      return id;
    }
  }
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  return `VIV-${stamp}`;
}

/** Déduit l'extension de fichier (.pdf/.txt/.md) — défaut .pdf. Pure. */
export function cvExtension(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.(pdf|txt|md)$/);
  return m ? `.${m[1]}` : '.pdf';
}

export type UpsertVivierInput = {
  email: string;
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cvContent: Buffer;
  cvFileName: string;
  cvMimeType: string;
  cvText: string;
  source: VivierSource;
};

export type UpsertVivierResult = {
  candidate: VivierCandidate;
  /** true = nouveau dossier, false = dossier existant mis à jour. */
  created: boolean;
};

/**
 * Crée ou met à jour un dossier vivier (déduplication par email). Le dossier
 * résultant est en statut `pending` : l'appelant déclenche ensuite l'indexation
 * (asynchrone). Lève si le Storage ou la base échoue (l'appelant traduit).
 */
export async function upsertVivierCandidate(
  input: UpsertVivierInput,
): Promise<UpsertVivierResult> {
  const email = normalizeEmail(input.email);
  const existing = await getVivierCandidateByEmail(email);
  const id = existing?.id ?? generateVivierId();

  // Upload du CV (écrase l'objet au même chemin si même extension).
  const upload = await uploadArtifactBinary({
    owner: { kind: 'vivier', id },
    name: `cv${cvExtension(input.cvFileName)}`,
    content: input.cvContent,
    mimeType: input.cvMimeType,
  });

  // Remplacement : purge l'ancien fichier s'il portait un chemin DIFFÉRENT
  // (extension changée) — pas d'accumulation de fichiers orphelins (§5).
  if (existing?.cvPath && existing.cvPath !== upload.path) {
    await deleteArtifact(existing.cvPath);
  }

  if (existing) {
    const updated = await updateVivierCandidateCV(id, {
      nom: input.nom,
      prenom: input.prenom,
      telephone: input.telephone,
      cvPath: upload.path,
      cvText: input.cvText,
    });
    // updateVivierCandidateCV ne renvoie null que si la ligne a disparu entre
    // le get et l'update (course rare) : on retombe sur une création.
    if (updated) return { candidate: updated, created: false };
  }

  const created = await insertVivierCandidate({
    id,
    email,
    nom: input.nom,
    prenom: input.prenom,
    telephone: input.telephone,
    cvPath: upload.path,
    cvText: input.cvText,
    source: input.source,
  });
  return { candidate: created, created: true };
}

export type VivierDeletionReason = 'candidate_request' | 'internal_decision';

export type DeleteVivierInput = {
  reason: VivierDeletionReason;
  actor?: string;
};

/**
 * Supprime un dossier (action irréversible). Ordre : fichier Storage d'abord
 * (artefact personnel le plus lourd) puis dossier (le `on delete cascade` purge
 * embedding + entités). Une trace ANONYMISÉE est écrite au journal : id du
 * dossier (non personnel), date, auteur, motif — JAMAIS de nom/email/CV.
 *
 * Renvoie `{ deleted: false }` si le dossier n'existe pas (déjà supprimé).
 */
export async function deleteVivierCandidate(
  id: string,
  input: DeleteVivierInput,
): Promise<{ deleted: boolean }> {
  const candidate = await getVivierCandidate(id);
  if (!candidate) return { deleted: false };

  // Storage en premier : `deleteArtifact` est idempotent (objet déjà absent =
  // pas d'erreur), donc une reprise après échec partiel reste sûre.
  if (candidate.cvPath) {
    await deleteArtifact(candidate.cvPath);
  }
  await deleteVivierCandidateRow(id);

  await appendJournalEntry({
    action: 'vivier_candidate_deleted',
    actor: input.actor ?? 'user',
    payload: { vivierId: id, reason: input.reason },
  });

  return { deleted: true };
}

/**
 * Un dossier n'est recherchable (présélection V2) QUE s'il est `indexed`.
 * Cristallise la garantie « pending/failed exclus des recherches » (§3.2/4.2).
 */
export function isVivierSearchable(candidate: VivierCandidate): boolean {
  return candidate.indexingStatus === 'indexed';
}
