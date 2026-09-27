'use client';

/**
 * Le SQUELETTE d'une carte d'*Aujourd'hui*.
 *
 * ⚠️ Il occupe la place que la carte prendra, pour que l'arrivée de la donnée
 * ne fasse pas sauter le reste de l'écran sous le curseur. Et il ne montre
 * AUCUN chiffre, pas même un zéro : sur un écran dont l'unique fonction est de
 * compter ce qui attend, un « 0 » affiché pendant le chargement se lit
 * « rien ne vous attend » — le pire mensonge possible ici.
 */

const BARRE = (largeur: number, hauteur = 12) => (
  <span
    aria-hidden
    style={{
      display: 'block',
      width: largeur,
      height: hauteur,
      borderRadius: 6,
      background: 'var(--dash-hover)',
    }}
  />
);

export function TodaySkeleton({ titre }: { titre: string }) {
  return (
    <section
      data-today-skeleton={titre}
      aria-busy="true"
      aria-label={`${titre} — chargement`}
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 12,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {BARRE(22, 22)}
        {BARRE(220, 15)}
      </div>
      {BARRE(320)}
      {BARRE(260)}
    </section>
  );
}
