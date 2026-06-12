import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { VivierValidationsWorklist } from '@/components/vivier/VivierValidationsWorklist';

export const metadata = {
  title: 'Validations vivier — QWESTINUM',
};

/**
 * Worklist des prises de contact vivier en attente (cf. docs/specs/vivier.md
 * §5). Route org-level (comme Vivier / Reporting / Settings) : liste les
 * campagnes ayant des candidats vivier à arbitrer, puis au clic les candidats
 * de la campagne (accepter la prise de contact / rejeter).
 */
export default function ValidationsVivierPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'Validations vivier' },
        ]}
      />
      <div className="relative mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <header className="mb-8">
          <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Sourcing interne
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Validations vivier
          </h1>
          <p className="mt-2 max-w-2xl font-body text-[14px] text-stone-600">
            Les prises de contact issues du vivier, en attente de votre décision.
            Choisissez une campagne pour arbitrer ses candidats : accepter la
            prise de contact (envoi d&apos;une invitation à postuler) ou rejeter.
          </p>
        </header>
        <VivierValidationsWorklist />
      </div>
      <SiteFooter />
    </main>
  );
}
