'use client';

/**
 * Barre de tête de /settings : ce qui demande attention, et l'ouverture en
 * masse.
 *
 * Le compteur d'alertes n'est pas décoratif — les réglages qui cassent le
 * pipeline le font en SILENCE (aucune adresse de synthèse cochée, pas de clé
 * d'envoi). Les annoncer ici évite de découvrir le problème par un candidat
 * qui n'a jamais reçu son mail.
 */

export function SettingsToolbar({
  warnings,
  openCount,
  total,
  onOpenAll,
  onCloseAll,
}: {
  warnings: number;
  openCount: number;
  total: number;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  const allOpen = openCount >= total;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-body text-[13px] text-stone-600">
        {warnings > 0 ? (
          <span className="font-semibold text-amber-800">
            {warnings} réglage{warnings > 1 ? 's' : ''} à compléter
          </span>
        ) : (
          <span className="text-stone-500">Tout est configuré.</span>
        )}
        <span className="text-stone-400">
          {' '}
          · {total} section{total > 1 ? 's' : ''}
        </span>
      </p>
      <button
        type="button"
        onClick={allOpen ? onCloseAll : onOpenAll}
        className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
      >
        {allOpen ? 'Tout replier' : 'Tout déplier'}
      </button>
    </div>
  );
}
