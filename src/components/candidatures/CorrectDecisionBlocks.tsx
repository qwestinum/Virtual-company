'use client';

/**
 * Blocs de lecture du dialog de correction — extraits de
 * `CorrectDecisionDialog` (limite 200 lignes/fichier).
 *
 * Les deux premiers blocs du dialog sont de la LECTURE : où en est le dossier,
 * et ce qui a déjà été déclenché. Ils ne portent aucune action — c'est
 * volontaire : on lit avant de choisir.
 */

import type {
  CorrectionOption,
  CorrectionTarget,
  DecisionCorrectionContext,
} from '@/types/decision-correction';

export function CurrentDecisionBlock({
  context,
}: {
  context: DecisionCorrectionContext;
}) {
  const when = context.decidedAt ? formatWhen(context.decidedAt) : null;
  return (
    <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
      <BlockLabel tone="neutral">État actuel</BlockLabel>
      <p className="mt-1 font-body text-[13px] font-semibold text-stone-800">
        {context.stageLabel}
      </p>
      <p className="font-body text-[12px] text-stone-500">
        {when ? `Marqué le ${when}` : 'Date de décision non enregistrée'}
        {/* Jamais un nom inventé : les marqueurs posés avant la capture
            d'identité n'ont pas d'auteur, et on l'écrit. */}
        {context.decidedBy ? ` par ${context.decidedBy}` : ' · auteur non enregistré'}
      </p>
    </div>
  );
}

export function SideEffectsBlock({
  context,
}: {
  context: DecisionCorrectionContext;
}) {
  if (context.sideEffects.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
      <BlockLabel tone="warning">⚠️ Ce qui a déjà été déclenché</BlockLabel>
      <ul className="mt-1.5 flex flex-col gap-1">
        {context.sideEffects.map((e) => (
          <li
            key={e.code + e.text}
            className={`font-body text-[12px] ${
              e.emphasis === 'warning'
                ? 'font-semibold text-amber-900'
                : 'text-stone-600'
            }`}
          >
            • {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TargetChoices({
  options,
  selected,
  onSelect,
}: {
  options: CorrectionOption[];
  selected: CorrectionTarget | null;
  onSelect: (target: CorrectionTarget) => void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        Nouvel état
      </legend>
      <div className="mt-2 flex flex-col gap-2">
        {options.map((o) => (
          <label
            key={o.target}
            className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${
              selected === o.target
                ? 'border-stone-400 bg-stone-50'
                : 'border-stone-200'
            }`}
          >
            <input
              type="radio"
              name="correction-target"
              checked={selected === o.target}
              onChange={() => onSelect(o.target)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-body text-[13px] font-semibold text-stone-800">
                {o.label}
              </span>
              <span className="block font-body text-[12px] text-stone-500">
                {o.detail}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BlockLabel({
  tone,
  children,
}: {
  tone: 'neutral' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <p
      className={`font-display text-[11px] font-semibold uppercase tracking-[0.14em] ${
        tone === 'warning' ? 'text-amber-800' : 'text-stone-500'
      }`}
    >
      {children}
    </p>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
