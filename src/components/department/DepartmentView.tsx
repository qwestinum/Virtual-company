'use client';

/**
 * Vue d'un département — wrapper réutilisable (Session 7 fix).
 *
 * Bandeau orange-jaune en haut (TopBanner avec breadcrumb), header
 * compact aligné à gauche, grille rectangulaire des services. Plus de
 * bouton Paramètres à ce niveau — l'accès se fait depuis le service.
 */

import { motion } from 'framer-motion';

import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
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
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/' },
          { label: meta.name },
        ]}
      />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-6 pt-16 pb-12">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          className="mb-8 flex items-center gap-4"
        >
          <div
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-xl text-[22px] text-white shadow-sm"
            style={{ background: meta.accent }}
          >
            {meta.icon}
          </div>
          <div>
            <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
              Département
            </p>
            <h1 className="font-display text-[24px] font-bold tracking-tight text-stone-900 leading-tight">
              {meta.name}
            </h1>
            <p className="font-body text-[13px] text-stone-600 mt-1 max-w-xl">
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
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {services.map((svc) => (
            <ServiceCard key={svc.id} {...svc} />
          ))}
        </motion.div>
      </div>
      <SiteFooter />
    </main>
  );
}
