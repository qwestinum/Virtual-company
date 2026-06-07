import { SiteFooter } from '@/components/navigation/SiteFooter';
import { TopBanner } from '@/components/navigation/TopBanner';
import { WorkspaceBackground } from '@/components/navigation/WorkspaceBackground';
import { ValidationsHub } from '@/components/validations/ValidationsHub';

export const metadata = {
  title: 'Validation suspendue — QWESTINUM',
};

/**
 * Page « Validation suspendue » (HITL).
 *
 * Deux listes côte à côte : candidats refusés / acceptés par le système, en
 * attente de validation humaine avant envoi du mail. Cf.
 * docs/specs/hitl-validation-suspendue.md.
 */
export default function ValidationsPage() {
  return (
    <main className="relative flex min-h-[100svh] flex-col">
      <WorkspaceBackground />
      <TopBanner
        breadcrumb={[
          { label: 'Lobby', href: '/app' },
          { label: 'Validation suspendue' },
        ]}
      />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <header className="mb-8">
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Human in the loop
          </p>
          <h1 className="font-display text-3xl font-bold text-stone-900">
            Validation suspendue
          </h1>
          <p className="font-body text-[14px] text-stone-600 mt-2 max-w-2xl">
            Les décisions du système en attente de votre validation. Rien n&apos;est
            envoyé tant que vous n&apos;avez pas tranché.
          </p>
        </header>
        <ValidationsHub />
      </div>
      <SiteFooter />
    </main>
  );
}
