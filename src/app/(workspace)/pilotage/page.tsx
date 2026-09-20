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
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        <ReportingHub />
      </div>
    </div>
  );
}
