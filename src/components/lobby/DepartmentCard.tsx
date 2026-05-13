'use client';

/**
 * Carte département circulaire (Session 7).
 *
 * La carte est un disque (240px) avec icône + libellé d'action à
 * l'intérieur. La description vit en dessous sous forme de légende.
 * État `active` → disque coloré et cliquable, halo glow pulse. État
 * `coming` → grisé + tag « Bientôt » à côté du nom.
 *
 * Animations :
 *   - apparition contrôlée par le parent via stagger,
 *   - hover : scale 1.04 + y −3px,
 *   - tap : scale 0.97,
 *   - halo : opacity & scale pulse 3.6s sur active.
 */

import { motion, type Variants } from 'framer-motion';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type DepartmentCardProps = {
  id: string;
  name: string;
  description: string;
  icon: string;
  accent: string;
  status: 'active' | 'coming';
  href?: string;
};

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] },
  },
};

const DISK = 240;

export function DepartmentCard(props: DepartmentCardProps) {
  const { name, description, status } = props;
  return (
    <motion.div
      variants={cardVariants}
      className="flex flex-col items-center gap-4 text-center"
    >
      <Disk {...props} />
      <div className="max-w-[260px]">
        <h3 className="font-display text-[16px] font-bold text-stone-900 leading-tight">
          {name}
          {status === 'coming' ? (
            <span className="ml-2 align-middle text-[9.5px] font-body font-semibold uppercase tracking-[0.08em] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              Bientôt
            </span>
          ) : null}
        </h3>
        <p className="font-body text-[12.5px] text-stone-600 leading-relaxed mt-1.5">
          {description}
        </p>
      </div>
    </motion.div>
  );
}

function Disk({ name, icon, accent, status, href }: DepartmentCardProps) {
  const isActive = status === 'active';
  const body = (
    <motion.div
      whileHover={isActive ? { scale: 1.04, y: -3 } : undefined}
      whileTap={isActive ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      className={cn(
        'relative grid place-items-center rounded-full select-none',
        isActive
          ? 'shadow-[0_10px_30px_rgba(15,23,42,0.12)]'
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
            ? { opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1] }
            : { opacity: 0 }
        }
        transition={
          isActive
            ? { duration: 3.6, ease: 'easeInOut', repeat: Infinity }
            : { duration: 0.3 }
        }
        className="absolute inset-[-12px] rounded-full pointer-events-none blur-xl"
        style={{ background: accent }}
      />
      <span
        aria-hidden
        className="absolute inset-3 rounded-full pointer-events-none"
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
          'text-[56px] leading-none drop-shadow-sm',
          active ? 'text-white' : 'text-stone-500',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'font-display text-[13px] font-bold uppercase tracking-[0.12em]',
          active ? 'text-white/95' : 'text-stone-500',
        )}
      >
        {active ? 'Entrer' : 'Bientôt'}
      </span>
    </div>
  );
}
