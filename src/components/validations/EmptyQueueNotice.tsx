'use client';

/**
 * État vide d'un sous-onglet de la file. FILTRE-CONSCIENT : « il n'y a rien »
 * et « le filtre masque tout » sont deux situations différentes, et les
 * confondre ferait croire une file vide alors qu'elle est pleine.
 */

export function EmptyQueueNotice({
  maskedByFilter,
  emptyLabel,
}: {
  /** Dossiers présents dans le sous-onglet mais écartés par le filtre. */
  maskedByFilter: number;
  /** Message quand le sous-onglet est réellement vide. */
  emptyLabel: string;
}) {
  return (
    <p className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center font-body text-[13px] italic text-stone-400">
      {maskedByFilter > 0
        ? `Aucune candidature pour ce référent — le filtre en masque ${maskedByFilter}.`
        : emptyLabel}
    </p>
  );
}
