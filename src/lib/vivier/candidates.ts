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
  setVivierCandidateCvPath,
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
  const cvName = `cv${cvExtension(input.cvFileName)}`;

  // Email connu ⇒ mise à jour du dossier existant (déduplication §2.3). Le
  // chemin Storage dérive de l'id STABLE du dossier (upload en place).
  if (existing) {
    const upload = await uploadArtifactBinary({
      owner: { kind: 'vivier', id: existing.id },
      name: cvName,
      content: input.cvContent,
      mimeType: input.cvMimeType,
    });
    // Purge l'ancien fichier s'il portait un chemin DIFFÉRENT (extension
    // changée) — pas d'accumulation de fichiers orphelins (§5).
    if (existing.cvPath && existing.cvPath !== upload.path) {
      await deleteArtifact(existing.cvPath);
    }
    const updated = await updateVivierCandidateCV(existing.id, {
      nom: input.nom,
      prenom: input.prenom,
      telephone: input.telephone,
      cvPath: upload.path,
      cvFileName: input.cvFileName,
      cvText: input.cvText,
    });
    if (updated) return { candidate: updated, created: false };
    // updateVivierCandidateCV ne renvoie null que si la ligne a disparu entre
    // le get et l'update (course rare) : on retombe sur la création ci-dessous.
  }

  // Email inconnu ⇒ création. L'id (uuid) est généré PAR LA BASE à l'insert ;
  // on uploade ensuite le CV sous le chemin dérivé de cet id, puis on renseigne
  // cv_path. Le dossier reste `pending` (prêt pour l'indexation).
  const inserted = await insertVivierCandidate({
    email,
    nom: input.nom,
    prenom: input.prenom,
    telephone: input.telephone,
    cvPath: null,
    cvFileName: input.cvFileName,
    cvText: input.cvText,
    source: input.source,
  });
  const upload = await uploadArtifactBinary({
    owner: { kind: 'vivier', id: inserted.id },
    name: cvName,
    content: input.cvContent,
    mimeType: input.cvMimeType,
  });
  const withCv = await setVivierCandidateCvPath(inserted.id, upload.path);
  return { candidate: withCv ?? inserted, created: true };
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
