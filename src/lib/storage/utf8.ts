/**
 * BOM UTF-8. Préfixé aux artefacts TEXTE à la livraison (upload Storage +
 * download local) pour forcer la détection UTF-8 par le navigateur/éditeur.
 *
 * Pourquoi un BOM et pas `charset=utf-8` dans le content-type : ce dernier
 * faisait échouer l'upload Supabase Storage (→ plus de publicUrl → l'icône
 * « ouvrir » du livrable disparaissait). Le BOM corrige le mojibake
 * (« â€" » au lieu de « — », « Ã© » au lieu de « é ») sans toucher au
 * content-type, donc l'upload reste intact.
 *
 * Défini via String.fromCharCode pour ne PAS écrire un caractère BOM littéral
 * (invisible) dans le source.
 */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Préfixe un BOM UTF-8 aux contenus texte (idempotent ; non-texte inchangé). */
export function withUtf8Bom(content: string, mime: string): string {
  if (!mime.startsWith('text/')) return content;
  return content.startsWith(UTF8_BOM) ? content : `${UTF8_BOM}${content}`;
}
