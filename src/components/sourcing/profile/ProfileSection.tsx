/**
 * Une section du rendu d'un parcours — la MÊME des deux côtés : détail d'un
 * profil (recruteur) et page d'atterrissage (candidat).
 *
 * Titre en petites capitales, icône dans une pastille, accent discret en
 * liseré gauche : on repère la section d'un coup d'œil, sans pavé de couleur.
 * Sans hook : rendable côté serveur.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { DASH_COLORS, type DashColor } from '@/components/dashboard/tokens';

export function ProfileSection({
  title,
  icon: Icon,
  accent,
  aside,
  children,
  testId,
}: {
  title: string;
  icon: LucideIcon;
  accent: DashColor;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const color = DASH_COLORS[accent];
  return (
    <section
      data-section={testId}
      className="rounded-lg border bg-white px-4 py-3"
      style={{ borderColor: 'var(--dash-border)', borderLeft: `3px solid ${color.solid}` }}
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: color.light, color: color.solid }}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3 className="flex-1 font-body text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--dash-text-secondary)' }}>
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
