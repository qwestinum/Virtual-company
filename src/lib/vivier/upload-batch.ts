/**
 * Helpers PURS de la file d'upload vivier (Session V1). Aucune dépendance
 * réseau/DOM : validation du lot de fichiers et détection de doublon
 * intra-lot, testables unitairement.
 *
 * Formats acceptés en V1 : PDF, TXT, MD (cohérent avec le pipeline
 * d'extraction existant). DOCX n'est PAS pris en charge — un fichier non
 * supporté produit un message EXPLICITE (jamais un échec silencieux).
 */

export const SUPPORTED_UPLOAD_EXTENSIONS = ['pdf', 'txt', 'md'] as const;

/** Extension en minuscules sans le point (`''` si aucune). Pure. */
export function fileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isSupportedUploadType(name: string): boolean {
  return (SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]).includes(
    fileExtension(name),
  );
}

/** Message utilisateur explicite pour un format non pris en charge. */
export function unsupportedFormatMessage(name: string): string {
  const ext = fileExtension(name);
  if (ext === 'docx' || ext === 'doc') {
    return 'Format DOCX non pris en charge pour le moment, convertissez en PDF.';
  }
  return `Format ${ext ? ext.toUpperCase() : 'inconnu'} non pris en charge — formats acceptés : PDF, TXT, MD.`;
}

export type UploadQueueItem = {
  /** Clé stable (index + nom) pour le rendu de la file. */
  key: string;
  name: string;
  supported: boolean;
  /** Motif de rejet si non supporté, sinon null. */
  reason: string | null;
};

/**
 * Construit la file d'upload à partir des fichiers déposés : marque les
 * formats non supportés (avec message) sans les écarter de l'affichage.
 */
export function buildUploadQueue(
  files: { name: string }[],
): UploadQueueItem[] {
  return files.map((f, idx) => {
    const supported = isSupportedUploadType(f.name);
    return {
      key: `${idx}:${f.name}`,
      name: f.name,
      supported,
      reason: supported ? null : unsupportedFormatMessage(f.name),
    };
  });
}

/**
 * Marque les doublons intra-lot par email (résolu côté serveur après
 * extraction). Le PREMIER fichier d'un email donné n'est pas un doublon ; les
 * suivants le sont (le serveur les a fusionnés sur le même dossier). Items sans
 * email (illisibles) ⇒ jamais doublons. Pur, ordre préservé.
 */
export function flagBatchDuplicatesByEmail<T extends { email: string | null }>(
  items: T[],
): boolean[] {
  const seen = new Set<string>();
  return items.map((it) => {
    if (!it.email) return false;
    const key = it.email.trim().toLowerCase();
    if (key === '') return false;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}
