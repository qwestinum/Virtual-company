'use client';

/**
 * L'ENTONNOIR EN SEGMENTS COLORÉS — la géométrie du mini-pipeline de
 * `CandidatureRow` (barres de 22 × 5 px, coins de 3 px), réemployée pour des
 * VOLUMES plutôt que pour une étape atteinte.
 *
 * ⚠️ Pourquoi pas des nombres gris. Une ligne de campagne alignait
 * « 1 reçues 0 retenus 0 écartés 0 en attente 1 sans suite » en gris : cinq
 * nombres de même poids qu'il fallait lire un par un pour voir lequel comptait.
 * Le segment porte la couleur de l'étape — la même que la pastille d'état de
 * la ligne et que le soulignement de la carte-compteur — et le nombre la
 * reprend. On voit la forme avant de lire les chiffres.
 *
 * Un volume à zéro garde son segment, en gris clair : une étape absente de la
 * suite ferait croire qu'elle n'existe pas dans le processus.
 */

export type SegmentCount = {
  label: string;
  count: number;
  /** Couleur de l'étape — un jeton, jamais une valeur écrite ici. */
  color: string;
};

export function SegmentedCounts({ items }: { items: readonly SegmentCount[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => {
        const vide = it.count === 0;
        return (
          <span key={it.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className="h-[5px] w-[22px] shrink-0 rounded-[3px]"
              style={{ background: vide ? 'var(--dash-border-strong)' : it.color }}
            />
            <span
              className="font-data text-[12px] font-semibold"
              style={{ color: vide ? 'var(--dash-text-tertiary)' : it.color }}
            >
              {it.count}
            </span>
            <span
              className="font-body text-[12px]"
              style={{ color: 'var(--dash-text-secondary)' }}
            >
              {it.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}
