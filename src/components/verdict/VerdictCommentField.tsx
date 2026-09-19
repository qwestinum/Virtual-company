'use client';

/**
 * Champ « Pourquoi cette décision ? » — le commentaire qui motive un verdict
 * final. Spec : docs/specs/compte-rendu-entretien.md §4.4, §16.
 *
 * FACULTATIF (arbitrage du 19/09/2026) : il accompagne le verdict quand le
 * recruteur l'écrit, il ne le conditionne pas. Pas de reformulation, pas
 * d'aide à la rédaction — le commentaire est 100 % humain.
 */

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
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-body text-[12.5px] font-semibold text-stone-700">
        Pourquoi cette décision ?{' '}
        <span className="font-normal text-stone-500">(facultatif)</span>
      </label>
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
      <p className="font-body text-[11.5px] text-stone-500">
        S’il est rédigé, ce commentaire fait partie du dossier. Le candidat peut
        en obtenir communication s’il exerce son droit d’accès.
      </p>
    </div>
  );
}
