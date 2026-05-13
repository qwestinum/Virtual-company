'use client';

/**
 * Template Next.js — wrapper re-monté à chaque navigation (Session 7).
 *
 * Contrairement à `layout.tsx` qui persiste entre les routes,
 * `template.tsx` est ré-instancié à chaque changement de segment. On
 * y pose donc l'animation d'entrée commune : fade léger + petit slide
 * vertical pour donner une impression de transition fluide entre
 * Lobby → Département → Service.
 *
 * Durée 220ms, easing pro (pas de bounce). On évite AnimatePresence
 * cross-routes : Next.js démonte la page précédente avant de monter
 * la suivante, donc le pattern « template fade-in only » suffit pour
 * l'effet voulu (et reste compatible avec le streaming RSC).
 */

import { motion } from 'framer-motion';

export default function RootTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
