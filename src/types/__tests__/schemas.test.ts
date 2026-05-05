import { describe, expect, it } from 'vitest';

import {
  AgentContractDataSchema,
  AgentDepartmentSchema,
  AgentStatusSchema,
  IOPortSchema,
  SkillSchema,
} from '@/types/agent';
import {
  CampaignSchema,
  CandidateSchema,
} from '@/types/campaign';
import {
  ConversationSchema,
  MessageSchema,
} from '@/types/chat';
import {
  TaskInputSchema,
  TaskMetricsSchema,
  TaskOutputSchema,
} from '@/types/task';

const VALID_DATETIME = '2026-05-05T10:00:00.000Z';

describe('task schemas', () => {
  it('accepts a valid TaskInput', () => {
    expect(
      TaskInputSchema.parse({
        taskId: 't1',
        correlationId: 'c1',
        agentId: 'cv-analyzer',
        payload: { cvUrl: 'https://x' },
        context: { priority: 'normal', requestedBy: 'user-1' },
      }),
    ).toBeDefined();
  });

  it('rejects invalid TaskInput priority', () => {
    const result = TaskInputSchema.safeParse({
      taskId: 't1',
      correlationId: 'c1',
      agentId: 'cv-analyzer',
      payload: {},
      context: { priority: 'urgent', requestedBy: 'user-1' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid TaskOutput', () => {
    expect(
      TaskOutputSchema.parse({
        taskId: 't1',
        status: 'success',
        data: { score: 87 },
        metrics: { durationMs: 1200, tokensUsed: 450, costEstimate: 0.012 },
        nextAgents: [],
      }),
    ).toBeDefined();
  });

  it('rejects negative metrics', () => {
    const result = TaskMetricsSchema.safeParse({
      durationMs: -1,
      tokensUsed: 10,
      costEstimate: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('agent schemas', () => {
  it('accepts known department / status enums', () => {
    expect(AgentDepartmentSchema.parse('rh')).toBe('rh');
    expect(AgentStatusSchema.parse('idle')).toBe('idle');
  });

  it('rejects unknown department', () => {
    expect(AgentDepartmentSchema.safeParse('hr').success).toBe(false);
  });

  it('validates IOPort and Skill', () => {
    const port = IOPortSchema.parse({
      id: 'in.cv',
      source: 'upload',
      format: 'pdf',
      description: 'CV file',
    });
    const skill = SkillSchema.parse({
      id: 'skill.parse',
      name: 'Parse CV',
      description: '',
      inputs: [port],
      outputs: [port],
    });
    expect(skill.inputs[0].id).toBe('in.cv');
  });

  it('accepts a complete AgentContractData', () => {
    const result = AgentContractDataSchema.safeParse({
      id: 'agent.cv',
      name: 'CV Analyzer',
      role: 'analyse les CV',
      department: 'rh',
      avatar: {
        modelUrl: '/models/analyst.glb',
        position: [0, 0, 0],
        animations: ['idle', 'working'],
      },
      enabled: true,
      status: 'idle',
      trigger: { type: 'punctual', source: 'upload' },
      humanValidation: { required: false, enabled: false },
      skills: [],
      inputs: [],
      outputs: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects avatar position with wrong arity', () => {
    const result = AgentContractDataSchema.safeParse({
      id: 'a',
      name: 'a',
      role: 'a',
      department: 'rh',
      avatar: {
        modelUrl: '/m.glb',
        position: [0, 0],
        animations: [],
      },
      enabled: true,
      status: 'idle',
      trigger: { type: 'punctual', source: 's' },
      humanValidation: { required: false, enabled: false },
      skills: [],
      inputs: [],
      outputs: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('chat schemas', () => {
  it('accepts a valid Message', () => {
    expect(
      MessageSchema.parse({
        id: 'm1',
        conversationId: 'conv1',
        role: 'manager',
        authorId: 'manager-rh',
        content: 'Bonjour',
        source: 'text',
        createdAt: VALID_DATETIME,
      }),
    ).toBeDefined();
  });

  it('rejects message with invalid datetime', () => {
    const result = MessageSchema.safeParse({
      id: 'm1',
      conversationId: 'conv1',
      role: 'user',
      authorId: 'u1',
      content: '',
      source: 'text',
      createdAt: 'yesterday',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a Conversation with empty messages', () => {
    expect(
      ConversationSchema.parse({
        id: 'c1',
        title: 'Recrutement Dev',
        participants: ['user-1', 'manager-rh'],
        messages: [],
        status: 'active',
        createdAt: VALID_DATETIME,
        updatedAt: VALID_DATETIME,
      }),
    ).toBeDefined();
  });
});

describe('campaign schemas', () => {
  it('accepts a valid Campaign', () => {
    expect(
      CampaignSchema.parse({
        id: 'camp1',
        name: 'Dev Senior 2026',
        jobTitle: 'Senior Software Engineer',
        description: '',
        criteria: {
          requiredSkills: ['typescript'],
          niceToHaveSkills: ['rust'],
          minYearsExperience: 5,
          remote: true,
        },
        status: 'active',
        ownerId: 'u1',
        createdAt: VALID_DATETIME,
        updatedAt: VALID_DATETIME,
      }),
    ).toBeDefined();
  });

  it('rejects candidate with invalid email', () => {
    const result = CandidateSchema.safeParse({
      id: 'cand1',
      campaignId: 'camp1',
      fullName: 'Jane Doe',
      email: 'not-an-email',
      profile: {
        summary: '',
        skills: [],
        yearsExperience: 3,
      },
      status: 'new',
      createdAt: VALID_DATETIME,
    });
    expect(result.success).toBe(false);
  });

  it('rejects candidate with score out of bounds', () => {
    const result = CandidateSchema.safeParse({
      id: 'cand1',
      campaignId: 'camp1',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      profile: { summary: '', skills: [], yearsExperience: 3 },
      score: 150,
      status: 'new',
      createdAt: VALID_DATETIME,
    });
    expect(result.success).toBe(false);
  });
});
