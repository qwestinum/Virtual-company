'use client';

/**
 * En-tête d'*Aujourd'hui* : la date, et le nombre de choses qui attendent.
 *
 * Il porte aussi l'aveu de lecture partielle. Un « Rien ne vous attend »
 * produit par une panne réseau serait le pire mensonge que cet écran puisse
 * faire : sa seule fonction est de dire ce qui reste à faire.
 */

export function TodayHeader({
  waiting,
  allClear,
  partial,
  onReload,
}: {
  waiting: number;
  allClear: boolean;
  partial: boolean;
  onReload: () => void;
}) {
  const jour = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <header>
      <p className="font-body text-[12px] capitalize text-stone-500">{jour}</p>
      <h1 className="mt-0.5 font-display text-2xl font-bold text-stone-900">
        {allClear
          ? 'Rien ne vous attend.'
          : `${waiting} chose${waiting > 1 ? 's' : ''} vous ${waiting > 1 ? 'attendent' : 'attend'}.`}
      </h1>
      {partial ? (
        <p className="mt-1 font-body text-[12px] text-amber-700">
          Une partie des données n&apos;a pas pu être lue — ce décompte est
          peut-être incomplet.{' '}
          <button
            type="button"
            onClick={onReload}
            className="min-h-6 font-semibold underline"
          >
            Réessayer
          </button>
        </p>
      ) : null}
    </header>
  );
}
