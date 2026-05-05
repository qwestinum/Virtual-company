import { z } from 'zod';

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high']);

export const TaskStatusSchema = z.enum([
  'success',
  'partial',
  'awaiting_validation',
  'error',
]);

export const TaskMetricsSchema = z.object({
  durationMs: z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  costEstimate: z.number().nonnegative(),
});

export const TaskContextSchema = z.object({
  campaignId: z.string().min(1).optional(),
  priority: TaskPrioritySchema,
  requestedBy: z.string().min(1),
});

export const TaskInputSchema = z.object({
  taskId: z.string().min(1),
  correlationId: z.string().min(1),
  agentId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  context: TaskContextSchema,
});

export const TaskOutputSchema = z.object({
  taskId: z.string().min(1),
  status: TaskStatusSchema,
  data: z.record(z.string(), z.unknown()),
  metrics: TaskMetricsSchema,
  nextAgents: z.array(z.string().min(1)),
});

export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;
export type TaskContext = z.infer<typeof TaskContextSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskOutput = z.infer<typeof TaskOutputSchema>;
