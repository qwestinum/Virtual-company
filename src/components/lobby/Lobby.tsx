'use client';

/**
 * Lobby — page racine de l'entreprise virtuelle (Session 7 fix).
 *
 * Cartes rectangulaires alignées à gauche en grille, bandeau
 * orange-jaune sticky en haut (logo + breadcrumb géré ailleurs).
 */

import { motion } from 'framer-motion';

import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';

import {
  DepartmentCard,
  type DepartmentCardProps,
} from './DepartmentCard';

// Palette orange-jaune homogène — les icônes des cartes actives
// reprennent un gradient amber/orange, les autres restent grises.
const DEPARTMENTS: DepartmentCardProps[] = [
  {
    id: 'rh',
    name: 'Ressources humaines',
    description:
      'Recrutement, administration du personnel, formation. Manager RH virtuel + agents IA spécialisés.',
    icon: '🧑‍💼',
    accent: 'linear-gradient(135deg, #FFB000, #FF8A00)',
    status: 'active',
    href: '/rh',
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Comptabilité, contrôle de gestion, trésorerie.',
    icon: '💰',
    accent: 'linear-gradient(135deg, #15A364, #12A594)',
    status: 'coming',
  },
  {
    id: 'commercial',
    name: 'Commercial',
    description: 'Prospection, qualification, négociation.',
    icon: '📊',
    accent: 'linear-gradient(135deg, #FFB000, #E8710A)',
    status: 'coming',
  },
  {
    id: 'tech',
    name: 'Tech',
    description: 'Développement, ops, sécurité.',
    icon: '⚙️',
    accent: 'linear-gradient(135deg, #2F6EEB, #12A594)',
    status: 'coming',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Contenu, social, growth.',
    icon: '🎨',
    accent: 'linear-gradient(135deg, #FF8A00, #E8710A)',
    status: 'coming',
  },
];

export function Lobby() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-6 pt-16 pb-12">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          className="mb-9 max-w-2xl"
        >
          <p className="font-display text-[10.5px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
            Départements
          </p>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold tracking-tight text-stone-900 leading-[1.15] mt-1">
            Une entreprise complète,
            <br />
            virtualisée et pilotable
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-3 leading-relaxed">
            Chaque département a son manager et ses agents spécialisés.
            Commencez par un, étendez à tous.
          </p>
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
          {DEPARTMENTS.map((dept) => (
            <DepartmentCard key={dept.id} {...dept} />
          ))}
        </motion.div>
      </div>

      <SiteFooter />
    </main>
  );
}
