'use client';

/**
 * Carte service rectangulaire (Session 7 fix).
 *
 * Variante un peu plus dense que DepartmentCard. Même grammaire :
 * icône carrée + nom + description, état actif en fond orange-jaune
 * à 30% d'opacité, état grisé en fond stone.
 */

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export type ServiceCardProps = {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  status: 'active' | 'coming';
  href?: string;
  /** Légère métadonnée (ex. « 2 campagnes en cours »). */
  meta?: string;
};

const ACTIVE_FILL = 'rgba(255, 176, 0, 0.3)';

export const serviceCardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] },
  },
};

export function ServiceCard(props: ServiceCardProps) {
  const { name, description, icon, accent, status, href, meta } = props;
  const isActive = status === 'active';
  const inner = (
    <motion.div
      variants={serviceCardVariants}
      whileHover={isActive ? { y: -3 } : undefined}
      whileTap={isActive ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      className={cn(
        'relative h-full overflow-hidden rounded-2xl border p-5',
        isActive
          ? 'border-amber-300 shadow-[0_3px_14px_rgba(255,176,0,0.15)] hover:shadow-[0_6px_18px_rgba(255,176,0,0.22)]'
          : 'border-stone-200 bg-stone-100/60 opacity-65',
      )}
      style={
        isActive ? { background: ACTIVE_FILL, backdropFilter: 'blur(2px)' } : undefined
      }
    >
      <div className="flex flex-col gap-2.5">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[19px] text-white shadow-sm"
          style={{
            background: isActive
              ? accent
              : 'linear-gradient(135deg, #d6d3d1, #a8a29e)',
          }}
        >
          {icon}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="font-display text-[15.5px] font-bold text-stone-900 leading-tight">
            {name}
          </h3>
          {!isActive ? (
            <span className="text-[9.5px] font-body font-semibold uppercase tracking-[0.08em] text-amber-800 bg-amber-200/70 px-1.5 py-0.5 rounded">
              Bientôt
            </span>
          ) : null}
        </div>
        <p className="font-body text-[12.5px] text-stone-700 leading-relaxed">
          {description}
        </p>
        {meta ? (
          <p className="font-data text-[11px] text-stone-600 mt-0.5">{meta}</p>
        ) : null}
        <div className="mt-1 text-[12px] font-body font-semibold">
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 text-stone-900">
              Ouvrir
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
        aria-label={`Ouvrir ${name}`}
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
