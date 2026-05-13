import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import type { TaskInput, TaskOutput } from '@/types/task';

/**
 * Publisher (Session 4+).
 *
 * Rôle métier : prend une annonce validée + un ou plusieurs channels
 * publiés (cf. PublicationChannel) et la diffuse sur les réseaux
 * correspondants via API/MCP. À la réception (webhook ou poll), il
 * ingère les candidatures (CV + métadonnées) et les pousse vers le
 * CV Analyzer.
 *
 * Implémentation : non opérationnel en Session 4 — la carte apparaît
 * dans la scène et la config est consommée par le cv-sources-picker
 * (cf. types/cv-source.ts) en prévision du branchement réel.
 */
export const publisherData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.publisher',
  name: 'Publisher',
  role: 'Diffuse l\'annonce sur les réseaux choisis (LinkedIn, Indeed, WTTJ, APEC, France Travail) et ingère les candidatures via API/MCP.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/publisher.glb',
    position: [0, 0, -2.5],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'punctual', source: 'manager-rh' },
  humanValidation: { required: false, enabled: false },
  skills: [
    {
      id: 'skill.publish-job-ad',
      name: 'Diffusion d\'annonce',
      description:
        'Pousse l\'annonce sur les channels actifs via leur API ou MCP dédié.',
      inputs: [
        {
          id: 'in.job-ad',
          source: 'job-writer',
          format: 'json',
          description: 'Annonce rédigée + tags.',
        },
        {
          id: 'in.channels',
          source: 'manager-rh',
          format: 'json',
          description: 'Liste des channels de publication choisis.',
        },
      ],
      outputs: [
        {
          id: 'out.publication',
          source: 'publisher',
          format: 'json',
          description: 'Confirmations de publication par channel + liens.',
        },
      ],
    },
    {
      id: 'skill.ingest-cv',
      name: 'Ingestion de CV',
      description:
        'Reçoit les candidatures via webhook ou poll des channels actifs et les transmet au CV Analyzer.',
      inputs: [
        {
          id: 'in.channel-event',
          source: 'cal.com',
          format: 'json',
          description: 'Événement entrant (candidature) reçu depuis un channel.',
        },
      ],
      outputs: [
        {
          id: 'out.cv',
          source: 'publisher',
          format: 'json',
          description: 'CV normalisé prêt à scorer.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.job-ad',
      source: 'job-writer',
      format: 'json',
      description: 'Annonce validée à publier.',
    },
    {
      id: 'in.channels',
      source: 'manager-rh',
      format: 'json',
      description: 'Channels actifs et flux de réception.',
    },
  ],
  outputs: [
    {
      id: 'out.publication',
      source: 'publisher',
      format: 'json',
      description: 'État des publications par channel.',
    },
    {
      id: 'out.cv',
      source: 'publisher',
      format: 'json',
      description: 'CV normalisés issus des flux entrants.',
    },
  ],
});

export const publisherAgent: AgentContract = {
  ...publisherData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
