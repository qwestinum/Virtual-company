import { z } from 'zod';

export const JobAdResultSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)),
});

export type JobAdResult = z.infer<typeof JobAdResultSchema>;

export type JobWriterMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};
