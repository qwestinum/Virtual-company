'use client';

/**
 * Grille hebdomadaire — plages LIBRES, jamais un gabarit matin/après-midi.
 *
 * Le choix compte : la plupart des outils imposent deux plages par jour et
 * obligent à contourner. Ici, un jour porte autant de plages qu'on veut, on
 * en ajoute une d'un clic, on la retire d'un clic. Un jour sans plage n'est
 * pas « fermé » par une case à cocher : il est simplement vide.
 */

import { Plus, X } from 'lucide-react';

import {
  minutesToTime,
  nextRuleFor,
  timeToMinutes,
  WEEKDAYS,
  type RuleDraft,
} from '@/lib/interviews/availability-form';

const TIME_INPUT =
  'rounded-md border border-stone-300 bg-white px-2 py-1 font-body text-[12.5px] text-stone-800 outline-none focus:border-blue-400';

export function WeeklyRulesEditor({
  rules,
  onChange,
}: {
  rules: RuleDraft[];
  onChange: (next: RuleDraft[]) => void;
}) {
  function updateAt(index: number, patch: Partial<RuleDraft>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {WEEKDAYS.map((day) => {
        // On garde l'index GLOBAL : c'est lui qui identifie la ligne à modifier,
        // un index local au jour se décalerait au premier retrait.
        const indexed = rules
          .map((rule, index) => ({ rule, index }))
          .filter((r) => r.rule.weekday === day.value);
        return (
          <div
            key={day.value}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
          >
            <span className="w-16 shrink-0 font-body text-[12.5px] font-semibold text-stone-700">
              {day.label}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {indexed.length === 0 ? (
                <span className="font-body text-[12px] italic text-stone-400">
                  aucune plage
                </span>
              ) : null}
              {indexed.map(({ rule, index }) => (
                <span key={index} className="flex items-center gap-1">
                  <input
                    type="time"
                    className={TIME_INPUT}
                    value={minutesToTime(rule.startMinute)}
                    aria-label={`${day.label} — début`}
                    onChange={(e) => {
                      const m = timeToMinutes(e.currentTarget.value);
                      if (m !== null) updateAt(index, { startMinute: m });
                    }}
                  />
                  <span className="font-body text-[12px] text-stone-400">→</span>
                  <input
                    type="time"
                    className={TIME_INPUT}
                    value={minutesToTime(rule.endMinute)}
                    aria-label={`${day.label} — fin`}
                    onChange={(e) => {
                      const m = timeToMinutes(e.currentTarget.value);
                      if (m !== null) updateAt(index, { endMinute: m });
                    }}
                  />
                  <button
                    type="button"
                    className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    aria-label={`Retirer la plage du ${day.label}`}
                    onClick={() => onChange(rules.filter((_, i) => i !== index))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-stone-300 px-2 py-1 font-body text-[12px] text-stone-600 hover:bg-stone-50"
              onClick={() => onChange([...rules, nextRuleFor(day.value, rules)])}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Plage
            </button>
          </div>
        );
      })}
    </div>
  );
}
