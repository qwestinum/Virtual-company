'use client';

/**
 * Carte service circulaire (Session 7).
 *
 * Variante plus compacte que DepartmentCard (disque 200px) — pensée
 * pour la grille services à l'intérieur d'un département. Mêmes
 * mécaniques d'animation (stagger via parent, hover scale, halo pulse
 * léger sur active).
 */

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ServiceCardProps = {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  status: 'active' | 'coming';
  href?: string;
  meta?: string;
};

export const serviceCardVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] },
  },
};

const DISK = 200;

export function ServiceCard(props: ServiceCardProps) {
  const { name, description, status, meta } = props;
  return (
    <motion.div
      variants={serviceCardVariants}
      className="flex flex-col items-center gap-3 text-center"
    >
      <Disk {...props} />
      <div className="max-w-[240px]">
        <h3 className="font-display text-[15px] font-bold text-stone-900 leading-tight">
          {name}
          {status === 'coming' ? (
            <span className="ml-2 align-middle text-[9.5px] font-body font-semibold uppercase tracking-[0.08em] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              Bientôt
            </span>
          ) : null}
        </h3>
        <p className="font-body text-[12px] text-stone-600 leading-relaxed mt-1.5">
          {description}
        </p>
        {meta ? (
          <p className="font-data text-[10.5px] text-stone-500 mt-1">{meta}</p>
        ) : null}
      </div>
    </motion.div>
  );
}

function Disk({ name, icon, accent, status, href }: ServiceCardProps) {
  const isActive = status === 'active';
  const body = (
    <motion.div
      whileHover={isActive ? { scale: 1.04, y: -3 } : undefined}
      whileTap={isActive ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      className={cn(
        'relative grid place-items-center rounded-full select-none',
        isActive
          ? 'shadow-[0_8px_24px_rgba(15,23,42,0.1)]'
          : 'opacity-60 grayscale',
      )}
      style={{
        width: DISK,
        height: DISK,
        background: isActive
          ? accent
          : 'linear-gradient(135deg, #e7e5e4, #d6d3d1)',
      }}
    >
      <motion.span
        aria-hidden
        animate={
          isActive
            ? { opacity: [0.3, 0.55, 0.3], scale: [1, 1.07, 1] }
            : { opacity: 0 }
        }
        transition={
          isActive
            ? { duration: 3.2, ease: 'easeInOut', repeat: Infinity }
            : { duration: 0.3 }
        }
        className="absolute inset-[-10px] rounded-full pointer-events-none blur-xl"
        style={{ background: accent }}
      />
      <span
        aria-hidden
        className="absolute inset-2.5 rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.45), transparent 55%)',
        }}
      />
      <DiskContent icon={icon} active={isActive} />
    </motion.div>
  );
  if (isActive && href) {
    return (
      <Link
        href={href}
        aria-label={`Entrer dans ${name}`}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-400"
      >
        {body}
      </Link>
    );
  }
  return (
    <div aria-disabled className="cursor-not-allowed">
      {body}
    </div>
  );
}

function DiskContent({
  icon,
  active,
}: {
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-2 px-6 text-center">
      <span
        aria-hidden
        className={cn(
          'text-[46px] leading-none drop-shadow-sm',
          active ? 'text-white' : 'text-stone-500',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'font-display text-[11.5px] font-bold uppercase tracking-[0.12em]',
          active ? 'text-white/95' : 'text-stone-500',
        )}
      >
        {active ? 'Ouvrir' : 'Bientôt'}
      </span>
    </div>
  );
}
