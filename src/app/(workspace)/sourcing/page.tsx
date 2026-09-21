import { PageShell } from '@/components/navigation/PageShell';
import { SourcingOverview } from '@/components/sourcing/SourcingOverview';

export const metadata = { title: 'Sourcing — QWESTINUM' };

/**
 * SOURCING — vue transverse, toutes campagnes.
 *
 * ⚠️ On ne lance AUCUNE recherche ici : le gate reste la campagne, qui porte
 * la fiche, les critères et le budget. Cette page constate, elle n'agit pas.
 */
export default function SourcingOverviewPage() {
  return (
    <PageShell
      title="Sourcing"
      subtitle="Vos approches en cours, toutes campagnes confondues. Une recherche se lance depuis la campagne concernée."
    >
      <SourcingOverview />
    </PageShell>
  );
}
