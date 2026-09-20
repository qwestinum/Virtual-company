'use client';

/**
 * Ligne d'une carte — COLONNES FIXES, dans cet ordre et jamais un autre :
 *
 *   [ nom, en évidence ] [ campagne — intitulé court ] [ état + depuis quand ] [ action ]
 *
 * L'intitulé de poste n'est JAMAIS collé au nom : « Mila Renard 72 · Directeur
 * de Dépt. Ops. · CAMP-2026-221 » se lisait comme une seule chaîne où l'œil ne
 * savait pas où s'arrêter. Chaque information a sa colonne, donc sa place
 * stable d'une ligne à l'autre — c'est ce qui rend une liste balayable.
 *
 * Polices et couleurs : celles du produit (`font-display` pour ce qui porte,
 * `font-body` pour ce qui se lit, jetons `--dash-text*`). Aucun serif, aucune
 * chasse fixe — le monospace appartient aux données qu'on compare en colonne.
 */

import Link from 'next/link';

export function TodayRow({
  name,
  campaign,
  state,
  action,
}: {
  name: string;
  campaign: string;
  state: string;
  action: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--dash-border)] py-2.5 last:border-b-0 sm:flex-nowrap"
    >
      <span
        className="font-display min-w-0 flex-1 basis-[10rem]"
        style={{ fontSize: 13, fontWeight: 700, color: 'var(--dash-text)' }}
      >
        {name}
      </span>
      <span
        className="font-body min-w-0 flex-1 basis-[11rem] truncate"
        style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
      >
        {campaign}
      </span>
      <span
        className="font-body min-w-0 flex-1 basis-[10rem]"
        style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
      >
        {state}
      </span>
      <span className="shrink-0">{action}</span>
    </div>
  );
}

/**
 * Action PRINCIPALE — le bouton EXISTANT du produit, celui de « Nouvelle
 * campagne » : pastille, dégradé bleu→violet, `font-display` 12/700.
 *
 * Un seul style d'action principale sur tout l'écran : deux styles pleins
 * concurrents, et le lecteur doit tout relire pour savoir ce qu'on attend de
 * lui.
 */
export function TodayPrimary({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-display inline-flex items-center"
      style={{
        padding: '6px 14px',
        borderRadius: 999,
        background: 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))',
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.02em',
        boxShadow: '0 2px 10px rgba(47,110,235,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Link>
  );
}

/** Action SECONDAIRE — le lien texte du produit. Jamais un second bouton. */
export function TodaySecondary({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-body inline-flex min-h-6 items-center hover:underline"
      style={{ fontSize: 12, fontWeight: 600, color: 'var(--dash-text-secondary)' }}
    >
      {label}
    </Link>
  );
}
