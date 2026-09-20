import Link from 'next/link';

import { ValidationsHub } from '@/components/validations/ValidationsHub';

export const metadata = { title: 'À valider — QWESTINUM' };

/**
 * Revue des dossiers à valider — dont le MODE GROUPÉ des propositions de refus.
 *
 * Ce n'est plus une entrée de premier niveau (« Validation suspendue » a
 * disparu de la barre) : on y vient depuis la puce « À valider » de
 * Candidatures. L'écran lui-même est INCHANGÉ — la partition en deux
 * sous-onglets, les cartes, le filtre par référent et le refus groupé n'ont
 * pas bougé d'une ligne. Seule la porte d'entrée change.
 */
export default function ValidationReviewPage() {
  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          href="/candidatures?statut=a_valider"
          className="mb-4 inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-500 hover:text-stone-900"
        >
          <span aria-hidden>←</span> Retour aux candidatures à valider
        </Link>
        <ValidationsHub />
      </div>
    </div>
  );
}
