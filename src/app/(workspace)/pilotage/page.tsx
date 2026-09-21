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
  // ⚠️ Le gabarit est rendu PLUS BAS (`PilotageShell`), par le sous-écran :
  // sa barre d'outils doit se ranger dans la zone de tête, au-dessus du filet,
  // et elle dépend d'un état client que cette page serveur n'a pas.
  return <ReportingHub />;
}
