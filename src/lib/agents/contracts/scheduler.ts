import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import type { TaskInput, TaskOutput } from '@/types/task';

export const schedulerData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.scheduler',
  name: 'Scheduler',
  role: 'Planifie les entretiens en croisant disponibilités candidat et agenda interne via Cal.com.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/scheduler.glb',
    position: [3, 0, 2],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'punctual', source: 'cal.com' },
  humanValidation: { required: false, enabled: false },
  skills: [
    {
      id: 'skill.find-slot',
      name: 'Recherche de créneau',
      description: 'Croise disponibilités candidat et agenda interne pour proposer un créneau.',
      inputs: [
        {
          id: 'in.candidate-availability',
          source: 'workflow',
          format: 'json',
          description: 'Disponibilités du candidat.',
        },
        {
          id: 'in.calendar',
          source: 'cal.com',
          format: 'json',
          description: 'Agenda interne (Cal.com).',
        },
      ],
      outputs: [
        {
          id: 'out.slot',
          source: 'scheduler',
          format: 'json',
          description: 'Créneau confirmé (date + participants).',
        },
      ],
    },
    {
      id: 'skill.send-invite',
      name: 'Envoi invitation',
      description: 'Émet l’invitation calendrier après confirmation.',
      inputs: [
        {
          id: 'in.slot',
          source: 'scheduler',
          format: 'json',
          description: 'Créneau confirmé.',
        },
      ],
      outputs: [
        {
          id: 'out.invite',
          source: 'scheduler',
          format: 'json',
          description: 'Invitation envoyée + ICS.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.candidate-availability',
      source: 'workflow',
      format: 'json',
      description: 'Disponibilités candidat.',
    },
    {
      id: 'in.calendar',
      source: 'cal.com',
      format: 'json',
      description: 'Agenda interne.',
    },
  ],
  outputs: [
    {
      id: 'out.invite',
      source: 'scheduler',
      format: 'json',
      description: 'Invitation calendrier confirmée.',
    },
  ],
});

export const schedulerAgent: AgentContract = {
  ...schedulerData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
