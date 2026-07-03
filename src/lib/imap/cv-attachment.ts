/**
 * Classification des pièces jointes reçues par mail (chemin IMAP). Pur, testé.
 *
 * Deux portes distinctes :
 *  - `isSupportedCvAttachment` : PDF + DOCX → extractibles par `extractCVText`
 *    (mammoth pour le .docx). Route vers le pipeline d'analyse normal.
 *  - `isUnsupportedCvAttachment` : formats clairement « CV Word » mais NON
 *    extractibles (.doc binaire ancien — pas d'extracteur). Un tel mail NE DOIT
 *    PAS s'évaporer dans `imap_email_no_cv` : c'est un vrai CV → on le TRACE
 *    (`imap_cv_unsupported_format`), jamais d'échec silencieux (beaucoup de CV
 *    arrivent en Word en recrutement).
 *
 * Détection par MIME **ou** par extension de fichier : beaucoup de clients mail
 * envoient un .docx en `application/octet-stream`, qu'un filtre MIME-only rate.
 * `extractCVText` route lui aussi le .docx par l'extension → cohérent.
 */

const SUPPORTED_CV_MIMES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Formats « clairement un CV » mais sans extracteur (binaire ancien). */
const UNSUPPORTED_CV_MIMES = new Set(['application/msword']);

const SUPPORTED_CV_EXTS = new Set(['pdf', 'docx']);
const UNSUPPORTED_CV_EXTS = new Set(['doc']);

/** Extension en minuscules, sans le point (`"CV.DocX"` → `"docx"`). */
export function fileExtension(name: string | null | undefined): string {
  if (!name) return '';
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/** PDF/DOCX : extractibles → pipeline d'analyse normal. */
export function isSupportedCvAttachment(
  mime: string | null | undefined,
  filename: string | null | undefined,
): boolean {
  if (SUPPORTED_CV_EXTS.has(fileExtension(filename))) return true;
  if (mime && SUPPORTED_CV_MIMES.has(mime.toLowerCase())) return true;
  return false;
}

/**
 * .doc ancien : clairement un CV mais NON extractible → à TRACER explicitement.
 * Le support prime : une PJ déjà supportée (.pdf/.docx) ne tombe jamais ici.
 */
export function isUnsupportedCvAttachment(
  mime: string | null | undefined,
  filename: string | null | undefined,
): boolean {
  if (isSupportedCvAttachment(mime, filename)) return false;
  if (UNSUPPORTED_CV_EXTS.has(fileExtension(filename))) return true;
  if (mime && UNSUPPORTED_CV_MIMES.has(mime.toLowerCase())) return true;
  return false;
}
