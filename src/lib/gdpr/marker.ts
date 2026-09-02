/**
 * Marqueurs de pseudonymisation RGPD — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §3.
 *
 * Deux formes, et la seconde n'est pas un caprice de style :
 *
 *   1. Le marqueur NOMINATIF `[effacé — demande RGPD <ref>]` remplace un nom,
 *      une adresse, un téléphone, un objet de message. Il porte la référence
 *      de l'instruction : un lecteur du journal sait POURQUOI la valeur a
 *      disparu, et sous quelle demande la retrouver côté responsable de
 *      traitement.
 *
 *   2. Le marqueur ORDINAL `[effacé-rgpd-<n>]` remplace un NOM DE FICHIER dans
 *      `imap_unmatched_cvs`, dont la colonne participe à l'index unique
 *      (mailbox_id, uid, file_name) — le garde-fou anti-résurrection.
 *      · `NULL` casserait le garde-fou : Postgres traite deux NULL comme
 *        DISTINCTS dans un index unique, la contrainte cesserait de mordre et
 *        un re-poll du même message recréerait la candidature effacée.
 *      · une EMPREINTE du nom de fichier ne protégerait rien : un nom de
 *        fichier a trop peu d'entropie, il se retrouve par force brute.
 *      · l'ordinal est une valeur, stable d'un rejeu à l'autre (il dépend du
 *        rang dans le groupe, pas d'un aléa), et ne dit rien de l'original.
 *
 * Les deux formes sont RECONNAISSABLES : c'est ce qui rend le rejeu idempotent
 * (« déjà effacé » se distingue de « à effacer ») et ce qui permet au contrôle
 * final de ne pas se plaindre de sa propre trace.
 */

/** Marqueur nominatif, porteur de la référence de l'instruction. */
export function erasureMarker(requestRef: string): string {
  const ref = requestRef.trim() || 'référence non précisée';
  return `[effacé — demande RGPD ${ref}]`;
}

/** Marqueur de nom de fichier : ordinal dans son groupe (mailbox, uid). */
export function fileNameMarker(ordinal: number): string {
  return `[effacé-rgpd-${ordinal}]`;
}

/**
 * Reconnaît N'IMPORTE QUEL marqueur posé par une purge, quelle que soit la
 * demande qui l'a posé. Volontairement large : un dossier touché par une
 * PREMIÈRE demande ne doit pas être re-signalé « à effacer » par une seconde.
 */
const MARKER_RE = /^\[effacé(?: — demande RGPD .*|-rgpd-\d+)\]$/u;

export function isErasureMarker(value: unknown): boolean {
  return typeof value === 'string' && MARKER_RE.test(value.trim());
}

/** Un marqueur peut être ENCHÂSSÉ dans un texte (corps de rapport réécrit). */
export function containsErasureMarker(value: unknown): boolean {
  return (
    typeof value === 'string' && /\[effacé(?: — demande RGPD |-rgpd-)/u.test(value)
  );
}
