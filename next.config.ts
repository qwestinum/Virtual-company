import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * `pdf-parse` doit rester externe au bundle serveur : il charge
   * dynamiquement son worker pdfjs par chemin filesystem, et Turbopack
   * le réécrit en identifiant interne (« [project]/… ») qui n'existe
   * pas sur disque.
   *
   * On NE met PAS `pdfjs-dist` ici : Next refuse de l'externaliser car
   * c'est un module ESM (`The package seems invalid. require() resolves
   * to a EcmaScript module`). Le worker pdfjs est résolu par chemin
   * physique construit depuis `process.cwd()` dans cv-extract.ts.
   *
   * `@napi-rs/canvas` (binaire natif `.node`) est externalisé pour ne pas
   * être bundlé par Turbopack. On l'importe directement dans cv-extract.ts
   * pour polyfiller DOMMatrix/ImageData/Path2D nous-mêmes — l'auto-polyfill
   * de pdfjs ne survit pas à l'encapsulation « external module » en prod.
   */
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas'],
  /**
   * Autorise les querystrings sur les images locales — utilisé pour
   * busting de cache après remplacement d'un asset (ex. `logo-orqa.png`).
   * Sans cette entrée, Next 16 jette un Runtime Error dès qu'une `src`
   * contient `?…`.
   */
  images: {
    localPatterns: [
      // Pas de champ `search` ⇒ accepte toute querystring (utile pour
      // les cache-busters genre `?v=4`). Avec `search: ''`, Next exige
      // au contraire l'absence totale de querystring → on l'évite.
      { pathname: '/**' },
    ],
  },
};

export default nextConfig;
