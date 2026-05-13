'use client';

/**
 * Lobby — page racine de l'entreprise virtuelle (Session 7).
 *
 * 5 disques département présentés en grille. Seul le RH est actif ;
 * les autres affichent un tag « Bientôt » et restent non cliquables.
 *
 * Stagger fade-in sur les disques via un container motion qui propage
 * `staggerChildren` aux DepartmentCard.
 */

import { motion } from 'framer-motion';
import Link from 'next/link';

import { OrqaLogo } from '@/components/navigation/OrqaLogo';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';

import {
  DepartmentCard,
  type DepartmentCardProps,
} from './DepartmentCard';

const DEPARTMENTS: DepartmentCardProps[] = [
  {
    id: 'rh',
    name: 'Ressources humaines',
    description:
      'Recrutement, administration du personnel, formation. Manager RH virtuel + agents IA spécialisés.',
    icon: '🧑‍💼',
    accent: 'linear-gradient(135deg, #2F6EEB, #7B5CFA)',
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
    accent: 'linear-gradient(135deg, #E8710A, #D6409F)',
    status: 'coming',
  },
  {
    id: 'tech',
    name: 'Tech',
    description: 'Développement, ops, sécurité.',
    icon: '⚙️',
    accent: 'linear-gradient(135deg, #3E63DD, #12A594)',
    status: 'coming',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Contenu, social, growth.',
    icon: '🎨',
    accent: 'linear-gradient(135deg, #D6409F, #E8710A)',
    status: 'coming',
  },
];

export function Lobby() {
  return (
    <main className="relative min-h-[100svh]">
      <WorkspaceBackground />
      <div className="relative mx-auto max-w-6xl px-6 py-14">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          className="mb-12 flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <OrqaLogo width={160} priority />
            <h1 className="font-display text-[32px] font-bold tracking-tight text-stone-900 leading-tight mt-4">
              Entreprise virtuelle
            </h1>
            <p className="font-body text-[14.5px] text-stone-600 mt-2 max-w-xl">
              Choisissez un département pour entrer dans son espace de travail.
              Chaque département dispose de ses propres agents IA, services et
              artefacts.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/70 backdrop-blur-sm border border-stone-200 text-[12.5px] font-body font-semibold text-stone-700 hover:bg-white hover:text-stone-900 transition-colors shadow-sm"
            aria-label="Paramètres"
          >
            <span aria-hidden>⚙</span>
            Paramètres
          </Link>
        </motion.header>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.06 } },
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-12 gap-x-8 place-items-center pt-4"
        >
          {DEPARTMENTS.map((dept) => (
            <DepartmentCard key={dept.id} {...dept} />
          ))}
        </motion.div>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.3 }}
          className="mt-16 text-center font-body text-[12px] text-stone-400"
        >
          Process First — l&apos;IA appliquée à des processus métier réels.
        </motion.footer>
      </div>
    </main>
  );
}
