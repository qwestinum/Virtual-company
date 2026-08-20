'use client';

/**
 * Aperçu des prochains créneaux — calculé par le MÊME moteur que la page
 * candidat, jamais par une reproduction approchée côté écran.
 *
 * C'est la seule vérification honnête d'une grille : « lundi 9h-12h » avec un
 * préavis de 48 h et une durée de 90 min ne donne pas ce qu'on imagine. Mieux
 * vaut s'en apercevoir ici que dans le mail d'un candidat.
 */

import type { Slot } from '@/lib/scheduling';

export function AvailabilityPreview({
  slots,
  timezone,
}: {
  slots: Slot[];
  timezone: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="font-body text-[12px] font-semibold text-stone-600">
        Prochains créneaux proposés
      </p>
      {slots.length === 0 ? (
        <p className="mt-1 font-body text-[12px] italic text-stone-500">
          Aucun créneau sur les deux prochaines semaines — vérifie les plages, le
          préavis et la durée.
        </p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {slots.map((slot) => (
            <li
              key={slot.startAt}
              className="rounded border border-stone-200 bg-white px-1.5 py-0.5 font-body text-[12px] text-stone-700"
            >
              {formatSlot(slot.startAt, timezone)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSlot(startAt: string, timeZone: string): string {
  try {
    return new Date(startAt).toLocaleString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
  } catch {
    // Fuseau saisi à la main et invalide : on n'efface pas l'aperçu pour
    // autant, on le rend dans le fuseau du navigateur.
    return new Date(startAt).toLocaleString('fr-FR');
  }
}
