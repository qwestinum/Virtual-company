import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import type { TaskInput, TaskOutput } from '@/types/task';

export const managerData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.manager-rh',
  name: 'Manager RH',
  role: 'Orchestre les demandes RH et dispatche les tâches aux agents spécialisés.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/manager.glb',
    position: [0, 0, 0.5],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'continuous', source: 'chat' },
  humanValidation: { required: false, enabled: false },
  skills: [
    {
      id: 'skill.collect-requirements',
      name: 'Collecte des besoins',
      description: 'Pose des questions pour cadrer la demande du donneur d’ordre.',
      inputs: [
        {
          id: 'in.user-message',
          source: 'chat',
          format: 'text',
          description: 'Message texte ou vocal transcrit.',
        },
      ],
      outputs: [
        {
          id: 'out.requirements',
          source: 'manager',
          format: 'json',
          description: 'Cahier des charges structuré.',
        },
      ],
    },
    {
      id: 'skill.dispatch-task',
      name: 'Dispatch de tâche',
      description: 'Sélectionne l’agent cible et lui transmet une TaskInput.',
      inputs: [
        {
          id: 'in.requirements',
          source: 'manager',
          format: 'json',
          description: 'Besoins consolidés.',
        },
      ],
      outputs: [
        {
          id: 'out.task',
          source: 'manager',
          format: 'task-input',
          description: 'TaskInput prêt à exécuter.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.user-message',
      source: 'chat',
      format: 'text',
      description: 'Message texte ou vocal du donneur d’ordre.',
    },
  ],
  outputs: [
    {
      id: 'out.task-dispatch',
      source: 'manager',
      format: 'task-input',
      description: 'Tâche dispatchée vers un agent.',
    },
    {
      id: 'out.user-reply',
      source: 'manager',
      format: 'text',
      description: 'Réponse au donneur d’ordre.',
    },
  ],
});

export const managerAgent: AgentContract = {
  ...managerData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
