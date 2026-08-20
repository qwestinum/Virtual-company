'use client';

/**
 * Exceptions datées — les congés, essentiellement.
 *
 * Une date suffit : le cas courant est « je ne suis pas là ce jour-là ». Les
 * blocages partiels existent côté module, mais les proposer ici ferait payer
 * à tout le monde la complexité d'un cas rare ; on les laisse au moteur.
 */

import { Plus, X } from 'lucide-react';
import { useState } from 'react';

export type ExceptionDraft = { day: string; label: string | null };

const INPUT =
  'rounded-md border border-stone-300 bg-white px-2 py-1 font-body text-[12.5px] text-stone-800 outline-none focus:border-blue-400';

export function ExceptionsEditor({
  exceptions,
  onChange,
}: {
  exceptions: ExceptionDraft[];
  onChange: (next: ExceptionDraft[]) => void;
}) {
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');

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
      </div>
    </div>
  );
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
