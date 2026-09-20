import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { BureauPulse } from '@/components/bureau/BureauPulse';

export const metadata = { title: "Aujourd'hui — QWESTINUM" };

/**
 * Entrée par défaut du workspace.
 *
 * ⚠️ ÉTAT TRANSITOIRE : elle sert pour l'instant le contenu de l'ancien
 * « Bureau ». L'écran de ce qui attend une action (À décider · Propositions de
 * refus · Entretiens · À vérifier) est le livrable du lot 2, et c'est à ce
 * moment que l'équipe d'agents et la répartition partent en « Pilotage ».
 *
 * Pourquoi un contenu provisoire plutôt qu'une page vide : l'entrée par défaut
 * est celle sur laquelle on atterrit à chaque connexion. Une coquille vide y
 * serait le premier écran du produit.
 */
export default function AujourdhuiPage() {
  return (
    <div className="flex h-full">
      <BureauPulse />
      <div className="relative flex-1 overflow-hidden">
        <HRDepartmentView />
        <AgentDetailsPanel />
      </div>
    </div>
  );
}
