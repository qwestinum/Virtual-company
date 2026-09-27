'use client';

/**
 * LA PASTILLE DE COMPTE — extraite de `WorkspaceNav`, qui en était le modèle,
 * et désormais la seule du produit.
 *
 * Petite, ronde, en chasse fixe : elle dit « il y en a N » à côté d'autre
 * chose, sans prendre de ligne. C'est ce que portent déjà les onglets de
 * navigation (« Candidatures 14 ⏳5 ») ; une carte-compteur qui a une
 * précision à donner prend la même, elle n'en invente pas une.
 *
 * ⚠️ Elle ne remplace JAMAIS un chiffre principal : un compteur se lit en
 * grand, une pastille se lit en second. Les confondre donnerait deux nombres
 * de même statut sur la même carte.
 */

import type { ReactNode } from 'react';

export type BadgeTone = 'alert' | 'waiting' | 'vivier';

const TONS: Record<BadgeTone, { fond: string; texte: string; bordure?: string }> = {
  /** Ce qui appelle un geste maintenant. */
  alert: { fond: '#e11d48', texte: '#fff' },
  /** Ce qui attend depuis trop longtemps — ambre, jamais rouge. */
  waiting: {
    fond: 'var(--dash-orange-light)',
    texte: 'var(--dash-orange)',
    bordure: 'color-mix(in srgb, var(--dash-orange) 40%, transparent)',
  },
  /** Le vivier, qui a sa couleur propre dans tout le produit. */
  vivier: { fond: '#059669', texte: '#fff' },
};

export function CountBadge({
  tone = 'alert',
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Ce que la pastille veut dire, pour qui la survole. */
  title?: string;
  children: ReactNode;
}) {
  const t = TONS[tone];
  return (
    <span
      title={title}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 align-middle font-data text-[10px] font-bold"
      style={{
        background: t.fond,
        color: t.texte,
        border: t.bordure ? `1px solid ${t.bordure}` : undefined,
      }}
    >
      {children}
    </span>
  );
}
