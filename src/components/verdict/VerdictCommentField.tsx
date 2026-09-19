'use client';

/**
 * Champ « Pourquoi cette décision ? » — le commentaire qui motive un verdict
 * final. Spec : docs/specs/compte-rendu-entretien.md §4.4, §14.1.
 *
 * Le compteur et la phrase de refus viennent de `assessCommentSubstance`, la
 * MÊME règle que la route : l'écran n'invente rien, il reflète ce que le
 * serveur exigera. Pas de reformulation, pas d'aide à la rédaction — le
 * commentaire est 100 % humain.
 */

import {
  assessCommentSubstance,
  describeCommentShortfall,
  MIN_COMMENT_WORDS,
} from '@/lib/candidatures/comment-substance';

export function VerdictCommentField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const substance = assessCommentSubstance(value);
  const shortfall = value.trim() === '' ? null : describeCommentShortfall(substance);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-body text-[12.5px] font-semibold text-stone-700">
          Pourquoi cette décision ?{' '}
          <span className="font-normal text-stone-500">(obligatoire)</span>
        </label>
        <span
          className={`font-data text-[11.5px] ${substance.ok ? 'text-emerald-700' : 'text-stone-500'}`}
          aria-live="polite"
        >
          {Math.min(substance.words, MIN_COMMENT_WORDS)} / {MIN_COMMENT_WORDS} mots
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Ce qui a pesé dans votre décision : ce que l’entretien a confirmé, ce qui manque, vos réserves éventuelles."
        className="w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2 font-body text-[13px] text-stone-800 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none disabled:opacity-60"
      />
      {shortfall ? (
        <p className="font-body text-[12px] text-amber-800">{shortfall}</p>
      ) : null}
      <p className="font-body text-[11.5px] text-stone-500">
        Ce commentaire fait partie du dossier. Le candidat peut en obtenir
        communication s’il exerce son droit d’accès.
      </p>
    </div>
  );
}
