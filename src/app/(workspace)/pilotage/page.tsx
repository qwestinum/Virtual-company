import { PageShell } from '@/components/navigation/PageShell';
import { ReportingHub } from '@/components/reporting/ReportingHub';

export const metadata = { title: 'Pilotage — QWESTINUM' };

/**
 * Pilotage — rapports et mesure.
 *
 * Reprend le Reporting tel quel. Les indicateurs, l'équipe d'agents et la
 * répartition par zone le rejoignent au lot 2 ; les taux de la carte campagne
 * au lot 3.
 */
export default function PilotagePage() {
  return (
    // ⚠️ GABARIT COMMUN : la page se bornait à 896 px et n'avait AUCUN titre
    // — seul écran de premier niveau dans ce cas.
    <PageShell title="Pilotage" subtitle="Les rapports de campagne et la vue transverse.">
      <ReportingHub />
    </PageShell>
  );
}
