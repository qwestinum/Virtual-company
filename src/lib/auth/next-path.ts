/**
 * Assainissement du paramètre `?next` des flux de login (anti open-redirect).
 *
 * Avec le multi-utilisateur, `/login?next=…` devient une brique de phishing
 * réelle : un lien piégé `?next=https://evil.tld` (ou `//evil.tld`, que les
 * navigateurs résolvent en URL absolue) redirigerait une session fraîchement
 * authentifiée hors de l'app. Règle : `next` n'est accepté QUE comme chemin
 * RELATIF INTERNE (`/…`), tout le reste retombe sur `/app`. Pur, client-safe.
 */

const DEFAULT_PATH = '/app';

export function sanitizeNextPath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  // Chemin interne = commence par exactement UN '/' : refuse '' (vide),
  // '//evil.tld' (protocole implicite), 'https://…', 'javascript:…', '\\'.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_PATH;
  }
  return value;
}
