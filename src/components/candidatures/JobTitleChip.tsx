/**
 * Chip « poste » d'une candidature (menu Candidatures).
 *
 * Met en évidence l'intitulé du poste de la campagne — l'information de
 * contexte n°1 quand on lit une liste de candidatures multi-campagnes. Teinte
 * ciel ORQA (accent produit), volontairement distincte du chip violet
 * « ★ Vivier » (origine du candidat) pour que les deux coexistent sans se
 * confondre. Tronqué : un intitulé long ne casse jamais la ligne.
 */
export function JobTitleChip({ title }: { title: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full shrink items-center rounded-md border border-orqa-ciel-clair/50 bg-orqa-cielbg px-2 py-0.5">
      <span className="truncate font-inter text-[12px] font-semibold text-orqa-nuit">
        {title}
      </span>
    </span>
  );
}
