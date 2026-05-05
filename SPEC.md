# Spécification — Virtual Enterprise MVP

## Vision
Un bureau virtuel où des employés IA (représentés en 3D) traitent des tâches RH.
Le donneur d'ordre discute avec le Manager RH qui coordonne les agents.

## Écrans

### Écran 1 : Bureau Virtuel (vue principale)
- Vue isométrique ou perspective d'un open space
- Chaque agent est un avatar 3D à son poste de travail
- L'avatar s'anime quand l'agent est actif (tape au clavier, réfléchit, parle)
- Cliquer sur un avatar ouvre son panneau détail
- Les flux entre agents sont visualisés (particules, lignes animées)
- Le Manager RH est au centre, plus grand, avec un bureau distinct

### Écran 2 : Chat avec le Manager RH
- Panel latéral ou modal conversationnel
- Le donneur d'ordre tape ou dicte (Whisper) sa demande
- Le Manager pose des questions une par une pour collecter les infos
- Messages formatés avec le nom et avatar du Manager
- Quand le Manager dispatch une tâche, on voit l'avatar correspondant s'activer

### Écran 3 : Dashboard
- KPIs globaux : tâches traitées, agents actifs, coût total, taux de succès
- Par agent : métriques individuelles, statut, dernière tâche
- Activité en temps réel : feed des actions
- Par campagne (si contexte RH) : candidats, scores, conversions

## Agents RH (MVP)

### Manager RH (Orchestrateur)
- Rôle : Point d'entrée, collecte les besoins, dispatch les tâches
- Avatar : Costume, bureau central, posture de leadership
- Trigger : Continu (écoute permanente du chat)
- Input : Message texte/vocal du donneur d'ordre
- Output : Tâches dispatchées aux agents + statut au donneur d'ordre
- Validation humaine : Non (il EST l'interface humaine)

### Agent CV Analyzer
- Rôle : Analyse et score les CV
- Avatar : Lunettes, pile de documents, studieux
- Trigger : Continu (flux email) ou ponctuel (upload)
- Inputs : CV (PDF/texte) + critères de la campagne
- Outputs : Profil structuré + score + synthèse
- Validation humaine : Configurable

### Agent Mail Composer
- Rôle : Rédige les emails RH
- Avatar : Clavier actif, écran lumineux
- Trigger : Ponctuel (déclenché par workflow)
- Inputs : Type de mail + données candidat + contexte
- Outputs : Email formaté
- Validation humaine : Oui par défaut

### Agent Job Writer
- Rôle : Rédige les annonces d'emploi
- Avatar : Créatif, post-its, écran avec texte
- Trigger : Ponctuel
- Inputs : Fiche de poste + ton + plateforme cible
- Outputs : Annonce optimisée multi-plateforme
- Validation humaine : Oui

### Agent Scheduler
- Rôle : Planifie les entretiens via Cal.com
- Avatar : Calendrier visible, organisé
- Trigger : Ponctuel
- Inputs : Disponibilités + agenda
- Outputs : Créneau confirmé + invitation
- Validation humaine : Configurable

## Contrat Agent (TypeScript)

```typescript
interface AgentContract {
  id: string;
  name: string;
  role: string;
  department: 'rh' | 'finance' | 'commercial' | 'tech' | 'marketing';

  avatar: {
    modelUrl: string;
    position: [number, number, number];
    animations: ('idle' | 'working' | 'talking' | 'thinking')[];
  };

  enabled: boolean;
  status: 'idle' | 'active' | 'error' | 'disabled';

  trigger: {
    type: 'continuous' | 'punctual';
    source: string;
  };

  humanValidation: {
    required: boolean;
    enabled: boolean;
  };

  skills: Skill[];
  inputs: IOPort[];
  outputs: IOPort[];

  execute(input: TaskInput): Promise<TaskOutput>;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  inputs: IOPort[];
  outputs: IOPort[];
}

interface IOPort {
  id: string;
  source: string;
  format: string;
  description: string;
}

interface TaskInput {
  taskId: string;
  correlationId: string;
  agentId: string;
  payload: Record<string, unknown>;
  context: {
    campaignId?: string;
    priority: 'low' | 'normal' | 'high';
    requestedBy: string;
  };
}

interface TaskOutput {
  taskId: string;
  status: 'success' | 'partial' | 'awaiting_validation' | 'error';
  data: Record<string, unknown>;
  metrics: {
    durationMs: number;
    tokensUsed: number;
    costEstimate: number;
  };
  nextAgents: string[];
}
```

## Flux principal MVP
1. Donneur d'ordre ouvre le chat avec Manager RH
2. Manager collecte les infos via conversation naturelle
3. Quand infos suffisantes → Manager confirme et dispatch
4. Visuellement : l'avatar Manager se tourne vers l'avatar cible
5. L'avatar cible s'active (animation "working")
6. Résultat affiché dans le chat + dashboard mis à jour
7. Si validation humaine requise → notification au donneur d'ordre

## Priorité d'implémentation
1. Types et contrats agents (fondation)
2. Store Zustand + event bus
3. Scène 3D basique avec avatars placeholder
4. Chat conversationnel avec Manager RH (OpenAI)
5. Dispatch et exécution d'un agent (CV Analyzer)
6. Dashboard avec métriques
7. Animations et polish visuel
