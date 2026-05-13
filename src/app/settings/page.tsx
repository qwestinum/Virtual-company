import Link from 'next/link';

import { SettingsHub } from '@/components/settings/SettingsHub';

export const metadata = {
  title: 'Paramètres — QWESTINUM',
};

/**
 * Hub de configuration (Session 6 v4).
 *
 * Cinq sections :
 *   - Adresse d'intake (boîte mail de réception des CV)
 *   - Adresse de synthèse (DRH — briefs entretien)
 *   - Adresse expéditeur (mails envoyés aux candidats)
 *   - Intégrations Flux (sources d'arrivée des CV)
 *   - Intégrations Canaux de diffusion (jobboards)
 *
 * La page est un server component minimaliste — toute la logique vit
 * dans `<SettingsHub />` (client).
 */
export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="mb-8">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Configuration
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Paramètres
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-2 max-w-2xl">
            Adresses email, flux d&apos;arrivée et canaux de diffusion. Les
            modifications sont appliquées au pipeline live dès la sauvegarde.
          </p>
          <Link
            href="/"
            className="font-body text-[12.5px] text-stone-500 hover:text-stone-900 mt-3 inline-block"
          >
            ← Retour au workspace
          </Link>
        </header>
        <SettingsHub />
      </div>
    </main>
  );
}
