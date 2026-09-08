'use client';

/**
 * Case « dépublier l'annonce APEC » du dialog de clôture.
 *
 * Extraite pour deux raisons, et la seconde est la vraie : tenir la règle des
 * 200 lignes, et surtout se placer HORS des branches du récapitulatif. Une
 * campagne sans aucune candidature en cours peut parfaitement avoir une offre
 * en ligne — c'est même le cas le plus courant d'un poste pourvu par une autre
 * voie. Laisser la case dans la branche « il reste des candidatures » l'aurait
 * escamotée précisément là.
 */

export type CampaignApecUnpublishOptionProps = {
  /** `null` ⇒ aucune offre en ligne : rien à proposer. */
  live: { numero: string | null } | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function CampaignApecUnpublishOption({
  live,
  checked,
  onChange,
}: CampaignApecUnpublishOptionProps) {
  if (!live) return null;
  return (
    <label className="mb-3 flex items-start gap-2 font-body text-[12.5px] text-stone-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="mt-0.5"
      />
      <span>
        Dépublier l’annonce APEC{live.numero ? ` (nº ${live.numero})` : ''} — sinon
        des candidats peuvent encore postuler à un poste fermé.
      </span>
    </label>
  );
}
