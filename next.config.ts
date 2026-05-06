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
   */
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;
