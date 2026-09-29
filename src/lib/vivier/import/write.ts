/**
 * Écriture d'UN dossier importé (ligne + fichier) — le seul chemin d'écriture
 * de l'import initial. Le script et la régression S28 l'appellent tous deux :
 * ce que la purge RGPD efface est bien ce que l'import écrit.
 *
 * INSERTION SEULEMENT : l'import ne met jamais à jour un dossier existant
 * (`upsertVivierCandidate` le ferait, et remplacerait le CV d'un candidat déjà
 * connu). Une adresse déjà présente — même insérée entre le constat et
 * l'écriture — rend `duplicate_email`.
 */

import {
  deleteVivierCandidateRow,
  insertVivierCandidate,
  setVivierCandidateCvPath,
} from '@/lib/db/repos/vivier';
import { uploadArtifactBinary } from '@/lib/storage/blob';
import type { VivierRetentionReferenceKind } from '@/types/vivier';

export type ImportedCandidateInput = {
  email: string;
  fullName: string;
  phone: string | null;
  fileName: string;
  mimeType: string;
  content: Buffer;
  text: string;
  fingerprint: string;
  provenance: string;
  retention: { at: string; kind: VivierRetentionReferenceKind };
};

export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|23505/u.test(msg);
}

export async function createImportedCandidate(
  input: ImportedCandidateInput,
): Promise<{ id: string } | 'duplicate_email'> {
  let created;
  try {
    created = await insertVivierCandidate({
      email: input.email.trim().toLowerCase(),
      nom: input.fullName,
      prenom: null,
      telephone: input.phone,
      cvPath: null,
      cvFileName: input.fileName,
      cvText: input.text,
      source: 'import',
      importMeta: {
        cvFingerprint: input.fingerprint,
        provenance: input.provenance,
        retentionReferenceAt: input.retention.at,
        retentionReferenceKind: input.retention.kind,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 'duplicate_email';
    throw err;
  }
  // Le fichier suit la ligne ; s'il ne passe pas, la ligne est RETIRÉE : un
  // dossier sans CV n'est pas un import réussi, et la relance le retentera
  // (l'empreinte n'est plus en base).
  try {
    const isPdf = input.mimeType === 'application/pdf';
    const upload = await uploadArtifactBinary({
      owner: { kind: 'vivier', id: created.id },
      name: isPdf ? 'cv.pdf' : 'cv.docx',
      content: input.content,
      // DOCX en octet-stream : le bucket peut refuser le type DOCX (liste
      // blanche du stockage). La lecture sert le type d'après le nom du fichier.
      mimeType: isPdf ? 'application/pdf' : 'application/octet-stream',
    });
    await setVivierCandidateCvPath(created.id, upload.path);
  } catch (err) {
    await deleteVivierCandidateRow(created.id).catch(() => {});
    throw new Error(`fichier non stocké (${err instanceof Error ? err.message : String(err)})`);
  }
  return { id: created.id };
}
