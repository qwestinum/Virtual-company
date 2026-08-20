'use client';

/**
 * Exceptions datées — les congés, essentiellement.
 *
 * Une date suffit : le cas courant est « je ne suis pas là ce jour-là ». Les
 * blocages partiels existent côté module, mais les proposer ici ferait payer
 * à tout le monde la complexité d'un cas rare ; on les laisse au moteur.
 */

import { CalendarDays, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { upcomingFrenchHolidays } from '@/lib/calendar/french-holidays';

export type ExceptionDraft = { day: string; label: string | null };

const INPUT =
  'rounded-md border border-stone-300 bg-white px-2 py-1 font-body text-[12.5px] text-stone-800 outline-none focus:border-blue-400';

export function ExceptionsEditor({
  exceptions,
  onChange,
  openWeekdays = [],
}: {
  exceptions: ExceptionDraft[];
  onChange: (next: ExceptionDraft[]) => void;
  /** Jours de la semaine réellement travaillés (ISO 1-7), pour ne pas
   *  encombrer la liste de fériés tombant un jour où l'on ne reçoit pas. */
  openWeekdays?: number[];
}) {
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Les fériés deviennent des absences ORDINAIRES : datées, libellées,
   * retirables une à une. Rien n'est imposé — certains cabinets reçoivent le
   * 11 novembre, et ce n'est pas au produit d'en décider.
   */
  function addFrenchHolidays() {
    const known = new Set(exceptions.map((e) => e.day));
    const fresh = upcomingFrenchHolidays({
      from: todayLocal(),
      openWeekdays,
    }).filter((h) => !known.has(h.day));
    if (fresh.length === 0) {
      setNotice('Les jours fériés à venir sont déjà dans la liste.');
      return;
    }
    onChange(
      [...exceptions, ...fresh].sort((a, b) => a.day.localeCompare(b.day)),
    );
    const plural = fresh.length > 1 ? 's' : '';
    setNotice(
      `${fresh.length} jour${plural} férié${plural} ajouté${plural} — retirez ceux que vous travaillez.`,
    );
  }

  function add() {
    if (!day) return;
    // Une même date deux fois ne bloque pas deux fois : on ignore le doublon
    // plutôt que d'afficher une erreur pour un geste sans conséquence.
    if (exceptions.some((e) => e.day === day)) {
      setDay('');
      setLabel('');
      return;
    }
    onChange(
      [...exceptions, { day, label: label.trim() || null }].sort((a, b) =>
        a.day.localeCompare(b.day),
      ),
    );
    setDay('');
    setLabel('');
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="font-body text-[12px] font-semibold text-stone-600">
        Jours d’absence
      </label>
      {exceptions.length === 0 ? (
        <p className="font-body text-[12px] italic text-stone-400">
          Aucune absence déclarée.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {exceptions.map((ex) => (
            <li
              key={ex.day}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-2 py-1"
            >
              <span className="font-body text-[12.5px] text-stone-700">
                {formatDay(ex.day)}
                {ex.label ? (
                  <span className="ml-1 text-stone-400">· {ex.label}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                aria-label={`Retirer l’absence du ${ex.day}`}
                onClick={() => onChange(exceptions.filter((e) => e.day !== ex.day))}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className={INPUT}
          value={day}
          aria-label="Date d’absence"
          onChange={(e) => setDay(e.currentTarget.value)}
        />
        <input
          className={`${INPUT} min-w-40 flex-1`}
          value={label}
          placeholder="Motif (facultatif)"
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-stone-300 px-2 py-1 font-body text-[12px] text-stone-600 hover:bg-stone-50 disabled:opacity-40"
          disabled={!day}
          onClick={add}
        >
          <Plus className="h-3 w-3" aria-hidden />
          Ajouter
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-stone-300 px-2 py-1 font-body text-[12px] text-stone-600 hover:bg-stone-50"
          title="Ajoute les jours fériés français de cette année et de la suivante"
          onClick={addFrenchHolidays}
        >
          <CalendarDays className="h-3 w-3" aria-hidden />
          Ajouter les jours fériés
        </button>
      </div>
      {notice ? (
        <p className="font-body text-[12px] text-stone-500" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** Date du jour telle que la voit le recruteur — jamais l'UTC : à 1h du matin
 *  à Paris, `toISOString()` renvoie encore la veille. */
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function formatDay(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
