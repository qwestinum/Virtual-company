import { z } from 'zod';

import type { TaskInput, TaskOutput } from './task';

export const AgentDepartmentSchema = z.enum([
  'rh',
  'finance',
  'commercial',
  'tech',
  'marketing',
]);

export const AgentStatusSchema = z.enum(['idle', 'active', 'error', 'disabled']);

export const TriggerTypeSchema = z.enum(['continuous', 'punctual']);

export const AnimationStateSchema = z.enum([
  'idle',
  'working',
  'talking',
  'thinking',
]);

export const IOPortSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  format: z.string().min(1),
  description: z.string(),
});

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  inputs: z.array(IOPortSchema),
  outputs: z.array(IOPortSchema),
});

export const AgentAvatarSchema = z.object({
  modelUrl: z.string().min(1),
  position: z.tuple([z.number(), z.number(), z.number()]),
  animations: z.array(AnimationStateSchema),
});

export const AgentTriggerSchema = z.object({
  type: TriggerTypeSchema,
  source: z.string().min(1),
});

export const HumanValidationSchema = z.object({
  required: z.boolean(),
  enabled: z.boolean(),
});

export const AgentContractDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  department: AgentDepartmentSchema,
  avatar: AgentAvatarSchema,
  enabled: z.boolean(),
  status: AgentStatusSchema,
  trigger: AgentTriggerSchema,
  humanValidation: HumanValidationSchema,
  skills: z.array(SkillSchema),
  inputs: z.array(IOPortSchema),
  outputs: z.array(IOPortSchema),
});

export type AgentDepartment = z.infer<typeof AgentDepartmentSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type AnimationState = z.infer<typeof AnimationStateSchema>;
export type IOPort = z.infer<typeof IOPortSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type AgentAvatar = z.infer<typeof AgentAvatarSchema>;
export type AgentTrigger = z.infer<typeof AgentTriggerSchema>;
export type HumanValidation = z.infer<typeof HumanValidationSchema>;
export type AgentContractData = z.infer<typeof AgentContractDataSchema>;

export type AgentContract = AgentContractData & {
  execute: (input: TaskInput) => Promise<TaskOutput>;
};
