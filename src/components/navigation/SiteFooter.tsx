'use client';

/**
 * SiteFooter — bandeau de pied de page partagé.
 *
 * Posé en bas de chaque page applicative (Lobby, Département, Service,
 * Settings). Fond bleu ciel à 5 % d'opacité (95 % de transparence)
 * avec backdrop-blur pour rester lisible sur le fond atelier ; texte
 * en noir, copyright + trois liens (mentions légales, RGPD, site).
 *
 * Le composant s'utilise comme dernier enfant d'un `main` en
 * `flex flex-col min-h-[100svh]` ; la zone de contenu intermédiaire
 * doit porter `flex-1` pour pousser le footer en bas.
 */

import { motion } from 'framer-motion';

const FOOTER_FILL = 'rgba(56, 189, 248, 0.05)'; // sky-400 à 5 % d'opacité

export function SiteFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4, duration: 0.3 }}
      className="relative w-full font-body text-[12px] text-black shadow-[0_-1px_0_rgba(56,189,248,0.25)]"
      style={{ background: FOOTER_FILL, backdropFilter: 'blur(6px)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-1.5 px-6 py-4">
        <p>© 2026 ORQA — une solution QWESTINUM. Tous droits réservés.</p>
        <nav
          aria-label="Liens de pied de page"
          className="flex items-center gap-3"
        >
          <a
            href="#"
            className="opacity-90 transition-opacity hover:opacity-100 underline-offset-2 hover:underline"
          >
            Mentions légales
          </a>
          <span aria-hidden className="text-black/40">
            ·
          </span>
          <a
            href="#"
            className="opacity-90 transition-opacity hover:opacity-100 underline-offset-2 hover:underline"
          >
            RGPD
          </a>
          <span aria-hidden className="text-black/40">
            ·
          </span>
          <a
            href="https://qwestinum.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-90 transition-opacity hover:opacity-100 underline-offset-2 hover:underline"
          >
            qwestinum.fr
          </a>
        </nav>
      </div>
    </motion.footer>
  );
}
