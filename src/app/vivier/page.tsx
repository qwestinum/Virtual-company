import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { VivierHub } from '@/components/vivier/VivierHub';

export const metadata = {
  title: 'Vivier — QWESTINUM',
};

/**
 * Vivier de candidats (cf. docs/specs/vivier.md). Stock interne de dossiers
 * candidats persistants, indépendant des campagnes. Route dédiée, org-level
 * (comme Reporting / Settings). Bandeau ORQA + fond atelier communs.
 */
export default function VivierPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[{ label: 'Lobby', href: '/app' }, { label: 'Vivier' }]}
      />
      <div className="relative mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <header className="mb-8">
          <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Sourcing interne
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Vivier de candidats
          </h1>
          <p className="mt-2 max-w-2xl font-body text-[14px] text-stone-600">
            Votre stock de CV, indexé et réutilisable. Déposez des candidatures,
            retrouvez-les d&apos;une campagne à l&apos;autre. Chaque dépôt est
            analysé puis indexé automatiquement.
          </p>
        </header>
        <VivierHub />
      </div>
      <SiteFooter />
    </main>
  );
}
