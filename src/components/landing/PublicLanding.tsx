'use client';

/**
 * Landing publique servie sur `/`.
 *
 * Hero minimaliste : logo ORQA, manifesto, CTA « Se connecter ».
 * Même palette/fond que le reste de l'app pour conserver la cohérence
 * visuelle, mais SANS bandeau ni breadcrumb — c'est une porte d'entrée,
 * pas une page applicative.
 */

import { motion } from 'framer-motion';
import Link from 'next/link';

import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { SiteFooter } from '@/components/navigation/SiteFooter';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';

export function PublicLanding() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
          className="flex max-w-xl flex-col items-center gap-6 text-center"
        >
          <OrqaLogo width={180} priority />

          <div>
            <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
              Entreprise virtuelle — QWESTINUM
            </p>
            <h1 className="font-display text-[28px] sm:text-[34px] font-bold tracking-tight text-stone-900 leading-[1.15] mt-2">
              Une entreprise complète,
              <br />
              virtualisée et pilotable
            </h1>
            <p className="font-body text-[14px] sm:text-[15px] text-stone-600 mt-3 leading-relaxed max-w-md mx-auto">
              Manager virtuel, agents IA spécialisés, processus métier réels.
              Connectez-vous pour accéder à votre cockpit.
            </p>
          </div>

          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 font-display text-[14px] font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #FFB000, #FF8A00)' }}
          >
            Se connecter
            <span aria-hidden>→</span>
          </Link>
        </motion.div>
      </div>

      <SiteFooter />
    </main>
  );
}
