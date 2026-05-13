import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import type { TaskInput, TaskOutput } from '@/types/task';

export const mailComposerData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.mail-composer',
  name: 'Mail Composer',
  role: 'Rédige les emails RH (relance, refus, invitation entretien, offre) à partir d’un contexte candidat.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/writer.glb',
    position: [2.85, 0, -0.43],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'punctual', source: 'workflow' },
  humanValidation: { required: true, enabled: true },
  skills: [
    {
      id: 'skill.compose-email',
      name: 'Rédaction email',
      description: 'Produit un email formaté (objet + corps) selon le type et le contexte.',
      inputs: [
        {
          id: 'in.email-type',
          source: 'workflow',
          format: 'enum',
          description: 'invitation | relance | refus | offre.',
        },
        {
          id: 'in.candidate',
          source: 'workflow',
          format: 'json',
          description: 'Données candidat.',
        },
        {
          id: 'in.context',
          source: 'workflow',
          format: 'json',
          description: 'Contexte additionnel (campagne, créneaux, ton).',
        },
      ],
      outputs: [
        {
          id: 'out.email',
          source: 'mail-composer',
          format: 'json',
          description: 'Email avec subject + bodyHtml + bodyText.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.email-type',
      source: 'workflow',
      format: 'enum',
      description: 'Type d’email à produire.',
    },
    {
      id: 'in.candidate',
      source: 'workflow',
      format: 'json',
      description: 'Données candidat.',
    },
    {
      id: 'in.context',
      source: 'workflow',
      format: 'json',
      description: 'Contexte additionnel.',
    },
  ],
  outputs: [
    {
      id: 'out.email',
      source: 'mail-composer',
      format: 'json',
      description: 'Email prêt à valider puis envoyer.',
    },
  ],
});

export const mailComposerAgent: AgentContract = {
  ...mailComposerData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
