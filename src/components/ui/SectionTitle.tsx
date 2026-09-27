'use client';

/**
 * LE TITRE DE SECTION du produit — l'échelle de Campagnes.
 *
 * ⚠️ Entretiens et Pilotage écrivaient les leurs en capitales grises de 11 px
 * (`text-[11px] uppercase tracking text-stone-500`) : une étiquette, pas un
 * titre. C'est la même faute que les libellés de champ, au niveau au-dessus —
 * et c'est ce qui faisait paraître ces écrans plus pauvres et plus petits que
 * Campagnes, à contenu égal.
 */

import type { ReactNode } from 'react';

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  /** Une ligne d'explication sous le titre. */
  hint?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h2
        className="font-display"
        style={{ fontSize: 16, fontWeight: 700, color: 'var(--dash-text)', margin: 0 }}
      >
        {children}
      </h2>
      {hint ? (
        <p
          className="font-body"
          style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)', marginTop: 3 }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
