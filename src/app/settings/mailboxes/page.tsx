import { MailboxesManager } from '@/components/settings/MailboxesManager';

export const metadata = {
  title: 'Boîtes mail — QWESTINUM',
};

/**
 * Page de configuration des boîtes mail IMAP surveillées par le
 * poller (Session 5 round 5). Server component minimaliste — la
 * logique vit dans `<MailboxesManager />`.
 */
export default function MailboxesSettingsPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="mb-8">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Configuration
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Boîtes mail
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-2 max-w-2xl">
            Ajoute des boîtes mail à surveiller pour la réception
            automatique des CVs. Quand un email arrive avec l&apos;ID de
            campagne dans l&apos;objet et un CV en pièce jointe, l&apos;agent
            CV Analyzer s&apos;exécute automatiquement.
          </p>
          <a
            href="/"
            className="font-body text-[12.5px] text-stone-500 hover:text-stone-900 mt-3 inline-block"
          >
            ← Retour au workspace
          </a>
        </header>
        <MailboxesManager />
      </div>
    </main>
  );
}
