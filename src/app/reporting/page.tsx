import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { ReportingHub } from '@/components/reporting/ReportingHub';

export const metadata = {
  title: 'Reporting — QWESTINUM',
};

/**
 * Module Reporting (cf. docs/specs/reporting.md). Onglet principal regroupant
 * rapports de campagne, multi-campagnes et audits. Bandeau ORQA + fond
 * atelier commun aux pages applicatives.
 */
export default function ReportingPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[{ label: 'Lobby', href: '/app' }, { label: 'Reporting' }]}
      />
      <div className="relative mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <header className="mb-8">
          <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Rapports & audits
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Reporting
          </h1>
          <p className="mt-2 max-w-2xl font-body text-[14px] text-stone-600">
            Bilans de campagne, analyses consolidées et audits à la demande.
            Chaque rapport matérialise la traçabilité native d&apos;ORQA.
          </p>
        </header>
        <ReportingHub />
      </div>
      <SiteFooter />
    </main>
  );
}
