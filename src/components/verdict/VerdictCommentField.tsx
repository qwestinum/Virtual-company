'use client';

/**
 * Zone « Pourquoi cette décision ? » — le commentaire qui motive un verdict
 * final. Spec : docs/specs/compte-rendu-entretien.md §4.4, §16.
 *
 * FACULTATIF (arbitrage du 19/09/2026) : il accompagne le verdict quand le
 * recruteur l'écrit, il ne le conditionne pas. Pas de reformulation, pas
 * d'aide à la rédaction — le commentaire est 100 % humain. Teinte ambre :
 * elle se distingue du compte rendu (bleu) au premier coup d'œil.
 *
 * La mention « s'il est rédigé, ce commentaire fait partie du dossier… droit
 * d'accès » sous le champ a été RETIRÉE le 22/09/2026 (demande du donneur
 * d'ordre). La règle ne change pas : le commentaire reste communicable au
 * candidat sur droit d'accès (spec §16).
 */

import { ZoneCard } from './ZoneCard';

export function VerdictCommentField({
  id,
  value,
  onChange,
  disabled,
  step,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  step?: number;
}) {
  return (
    <ZoneCard tone="comment" step={step} title="Pourquoi cette décision ?" titleFor={id}>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Ce qui a pesé dans votre décision : ce que l’entretien a confirmé, ce qui manque, vos réserves éventuelles."
        className="w-full resize-y rounded-lg border border-amber-200 bg-white px-3 py-2 font-body text-[13px] text-stone-800 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none disabled:opacity-60"
      />
    </ZoneCard>
  );
}
