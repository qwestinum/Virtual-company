import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * pdf-parse + pdfjs-dist doivent rester externes au bundle serveur :
   * leur worker est chargé dynamiquement par chemin filesystem, et
   * Turbopack le réécrit en identifiant interne (« [project]/… ») qui
   * n'existe pas sur disque. En les externalisant, Node les résout
   * nativement via require() à runtime (cf. fix Session 4 sur
   * cv-extract.ts).
   */
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
