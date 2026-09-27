'use client';

/**
 * RANGÉE — une décision qui se détache.
 *
 * Fond blanc franc dans la teinte de son sous-bloc, bordure fine, coins
 * arrondis, 8 px entre rangées. C'est la rangée du Sourcing
 * (`SourcingProfileRow` : `rounded-md border bg-white px-3 py-2`), reprise
 * telle quelle — un trait fin comme seul séparateur séparait sans
 * hiérarchiser, et l'œil ne savait pas où une décision commençait.
 *
 * COLONNES FIXES, dans cet ordre et jamais un autre :
 *   [ nom, en évidence ] [ campagne — intitulé court ] [ état ] [ action ]
 *
 * L'intitulé de poste n'est JAMAIS collé au nom : chaque information a sa
 * colonne, donc sa place stable d'une rangée à l'autre — c'est ce qui rend une
 * liste balayable. Aucune chasse fixe : le monospace appartient aux données
 * qu'on compare colonne par colonne, pas à un nom ni à une date.
 *
 * L'action est TOUJOURS secondaire : l'écran n'a qu'un bouton principal, et il
 * est dans l'en-tête.
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
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-white px-3 py-2 sm:flex-nowrap"
      style={{ borderColor: 'var(--dash-border)' }}
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
