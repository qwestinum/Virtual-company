import type {
  AgentContract,
  AgentContractData,
  AgentDepartment,
} from '@/types/agent';

import { cvAnalyzerAgent } from './contracts/cv-analyzer';
import { jobWriterAgent } from './contracts/job-writer';
import { mailComposerAgent } from './contracts/mail-composer';
import { managerAgent } from './contracts/manager';
import { publisherAgent } from './contracts/publisher';
import { schedulerAgent } from './contracts/scheduler';

export const AGENT_REGISTRY: ReadonlyArray<AgentContract> = [
  managerAgent,
  cvAnalyzerAgent,
  mailComposerAgent,
  jobWriterAgent,
  publisherAgent,
  schedulerAgent,
];

export function getAgentById(id: string): AgentContract | undefined {
  return AGENT_REGISTRY.find((agent) => agent.id === id);
}

export function getAgentsByDepartment(
  department: AgentDepartment,
): AgentContract[] {
  return AGENT_REGISTRY.filter((agent) => agent.department === department);
}

export function getAgentDataSnapshot(): Record<string, AgentContractData> {
  const snapshot: Record<string, AgentContractData> = {};
  for (const agent of AGENT_REGISTRY) {
    const { execute: _execute, ...data } = agent;
    snapshot[agent.id] = data;
  }
  return snapshot;
}

export function getAgentOrder(): string[] {
  return AGENT_REGISTRY.map((agent) => agent.id);
}
