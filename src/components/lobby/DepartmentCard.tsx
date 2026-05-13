'use client';

/**
 * Carte département rectangulaire (Session 7 fix).
 *
 * Plus de disque. Format pavé classique :
 *   - icône carrée en haut à gauche,
 *   - nom + description,
 *   - tag « Bientôt » à droite du nom pour les `coming`.
 *
 * État `active` → fond orange-jaune à 30% d'opacité, hover scale doux.
 * État `coming` → grisé, opacity réduite, pas de hover.
 */

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export type DepartmentCardProps = {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Gradient CSS pour l'icône carrée. */
  accent: string;
  status: 'active' | 'coming';
  href?: string;
};

const ACTIVE_FILL = 'rgba(255, 176, 0, 0.3)';

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] },
  },
};

export function DepartmentCard(props: DepartmentCardProps) {
  const { name, description, icon, accent, status, href } = props;
  const isActive = status === 'active';
  const inner = (
    <motion.div
      variants={cardVariants}
      whileHover={isActive ? { y: -3 } : undefined}
      whileTap={isActive ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      className={cn(
        'relative h-full overflow-hidden rounded-2xl border p-6',
        isActive
          ? 'border-amber-300 shadow-[0_4px_18px_rgba(255,176,0,0.18)] hover:shadow-[0_8px_24px_rgba(255,176,0,0.25)]'
          : 'border-stone-200 bg-stone-100/60 opacity-65',
      )}
      style={
        isActive ? { background: ACTIVE_FILL, backdropFilter: 'blur(2px)' } : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[22px] text-white shadow-sm"
          style={{
            background: isActive
              ? accent
              : 'linear-gradient(135deg, #d6d3d1, #a8a29e)',
          }}
        >
          {icon}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="font-display text-[17px] font-bold text-stone-900 leading-tight">
            {name}
          </h3>
          {!isActive ? (
            <span className="text-[9.5px] font-body font-semibold uppercase tracking-[0.08em] text-amber-800 bg-amber-200/70 px-1.5 py-0.5 rounded">
              Bientôt
            </span>
          ) : null}
        </div>
        <p className="font-body text-[13px] text-stone-700 leading-relaxed">
          {description}
        </p>
        <div className="mt-2 text-[12px] font-body font-semibold">
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 text-stone-900">
              Entrer
              <span aria-hidden className="text-stone-700">
                →
              </span>
            </span>
          ) : (
            <span className="text-stone-500">Bientôt disponible</span>
          )}
        </div>
      </div>
    </motion.div>
  );
  if (isActive && href) {
    return (
      <Link
        href={href}
        aria-label={`Entrer dans ${name}`}
        className="block h-full focus:outline-none"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div aria-disabled className="block h-full cursor-not-allowed">
      {inner}
    </div>
  );
}
