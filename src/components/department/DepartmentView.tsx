'use client';

/**
 * Vue d'un département — wrapper réutilisable (Session 7).
 *
 * Pose le breadcrumb, le header animé et la grille de ServiceCard
 * circulaires avec stagger. Background atelier commun et accès
 * paramètres toujours visible en haut à droite.
 */

import { motion } from 'framer-motion';
import Link from 'next/link';

import { Breadcrumb } from '@/components/navigation/Breadcrumb';
import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';

import { ServiceCard, type ServiceCardProps } from './ServiceCard';

export type DepartmentMeta = {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  accent: string;
};

export type DepartmentViewProps = {
  meta: DepartmentMeta;
  services: ServiceCardProps[];
};

export function DepartmentView({ meta, services }: DepartmentViewProps) {
  return (
    <main className="relative min-h-[100svh]">
      <WorkspaceBackground />
      <div className="relative mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="Retour au Lobby">
              <OrqaLogo width={120} />
            </Link>
            <Breadcrumb
              items={[
                { label: '🏠 Lobby', href: '/' },
                { label: meta.name },
              ]}
            />
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/70 backdrop-blur-sm border border-stone-200 text-[12.5px] font-body font-semibold text-stone-700 hover:bg-white hover:text-stone-900 transition-colors shadow-sm"
            aria-label="Paramètres"
          >
            <span aria-hidden>⚙</span>
            Paramètres
          </Link>
        </div>

        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          className="mt-8 mb-10 flex items-start gap-4"
        >
          <div
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full text-[26px] text-white shadow-md"
            style={{ background: meta.accent }}
          >
            {meta.icon}
          </div>
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
              Département
            </p>
            <h1 className="font-display text-[26px] font-bold tracking-tight text-stone-900 leading-tight">
              {meta.name}
            </h1>
            <p className="font-body text-[13.5px] text-stone-600 mt-1.5 max-w-xl">
              {meta.tagline}
            </p>
          </div>
        </motion.header>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.06 } },
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-10 gap-x-8 place-items-center pt-4"
        >
          {services.map((svc) => (
            <ServiceCard key={svc.id} {...svc} />
          ))}
        </motion.div>
      </div>
    </main>
  );
}
