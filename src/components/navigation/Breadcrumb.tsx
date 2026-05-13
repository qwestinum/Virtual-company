'use client';

/**
 * Breadcrumb de navigation multi-niveaux (Session 7).
 *
 * Affiche le fil d'Ariane « Lobby › RH › Recrutement » au-dessus des
 * pages internes. Chaque crumb est un lien `next/link` ; le dernier
 * (page courante) reste un span statique mis en évidence. L'apparition
 * du breadcrumb à chaque navigation profite de la fade du
 * `template.tsx` ; en parallèle on monte un stagger discret par
 * segment pour donner une impression de chemin qui se reconstruit.
 */

import { motion } from 'framer-motion';
import Link from 'next/link';
import type { ReactNode } from 'react';

export type BreadcrumbItem = {
  label: ReactNode;
  href?: string; // absent = segment courant (non cliquable)
};

export type BreadcrumbProps = {
  items: BreadcrumbItem[];
};

const SEP = '›';

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex items-center gap-1.5 text-[12.5px] font-body text-stone-500"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <motion.span
            key={`${i}-${typeof item.label === 'string' ? item.label : i}`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: i * 0.04,
              duration: 0.22,
              ease: [0.2, 0.7, 0.2, 1],
            }}
            className="inline-flex items-center gap-1.5"
          >
            {i > 0 ? (
              <span aria-hidden className="text-stone-300 text-[12px]">
                {SEP}
              </span>
            ) : null}
            {isLast || !item.href ? (
              <span className="font-semibold text-stone-900">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-stone-900 transition-colors"
              >
                {item.label}
              </Link>
            )}
          </motion.span>
        );
      })}
    </nav>
  );
}
