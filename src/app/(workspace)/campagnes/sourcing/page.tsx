import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SourcingWorkspace } from '@/components/sourcing/SourcingWorkspace';
import { isSourcingEnabled } from '@/lib/sourcing/flag';

export const metadata = { title: 'Approcher des profils — QWESTINUM' };

/**
 * ⚠️ Rendu à la DEMANDE, jamais prérendu. Le flag est un réglage à deux étages
 * (variable d'environnement + `app_settings`) : figé au build, une installation
 * qui active le module plus tard continuerait de recevoir un 404, et une
 * installation qui l'éteint continuerait de servir l'écran. Un flag qu'on ne
 * peut plus éteindre n'est plus un flag.
 */
export const dynamic = 'force-dynamic';

/**
 * Approche de profils publics (module Sourcing).
 *
 * Plus une entrée de premier niveau : on sourcera depuis la carte d'une
 * campagne (lot 3). L'écran garde une adresse d'ici là.
 *
 * Le flag se lit ICI, côté serveur (deux étages, fail-closed) : module éteint
 * ⇒ 404, jamais un écran grisé — un écran grisé confirmerait une surface qui
 * n'existe pas.
 */
export default async function SourcingPage() {
  if (!(await isSourcingEnabled())) notFound();
  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-4">
        <Link
          href="/campagnes"
          className="inline-flex min-h-6 items-center gap-1.5 font-body text-[13px] font-semibold text-stone-500 hover:text-stone-900"
        >
          <span aria-hidden>←</span> Retour aux campagnes
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SourcingWorkspace />
      </div>
    </div>
  );
}
