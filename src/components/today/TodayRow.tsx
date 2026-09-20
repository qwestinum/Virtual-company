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
