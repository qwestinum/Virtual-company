import Link from 'next/link';

import { VivierValidationsWorklist } from '@/components/vivier/VivierValidationsWorklist';

export const metadata = { title: 'Prises de contact vivier — QWESTINUM' };

/**
 * Prises de contact issues du vivier, en attente d'arbitrage.
 *
 * Plus une entrée de premier niveau : ces propositions relèvent d'une
 * campagne. Le lot 4 fera disparaître cette file au profit d'une décision
 * prise SUR PLACE dans la recherche vivier d'une campagne — d'ici là l'écran
 * reste atteignable, faute de quoi les propositions déjà en attente
 * deviendraient invisibles.
 */
export default function VivierValidationsPage() {
  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        <Link
          href="/campagnes"
          className="mb-4 inline-flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-500 hover:text-stone-900"
        >
          <span aria-hidden>←</span> Retour aux campagnes
        </Link>
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Prises de contact vivier
          </h1>
          <p className="mt-2 max-w-2xl font-body text-[14px] text-stone-600">
            Les profils de votre vivier proposés pour une campagne. Choisissez
            une campagne pour arbitrer : accepter la prise de contact (envoi
            d&apos;une invitation à postuler) ou rejeter.
          </p>
        </header>
        <VivierValidationsWorklist />
      </div>
    </div>
  );
}
