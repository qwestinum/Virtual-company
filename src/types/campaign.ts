import { z } from 'zod';

export const CampaignStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'closed',
]);

export const CandidateStatusSchema = z.enum([
  'new',
  'screening',
  'shortlisted',
  'interview',
  'offer',
  'hired',
  'rejected',
]);

export const CampaignCriteriaSchema = z.object({
  requiredSkills: z.array(z.string().min(1)),
  niceToHaveSkills: z.array(z.string().min(1)),
  minYearsExperience: z.number().int().nonnegative(),
  location: z.string().optional(),
  remote: z.boolean(),
});

export const CampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  jobTitle: z.string().min(1),
  description: z.string(),
  criteria: CampaignCriteriaSchema,
  status: CampaignStatusSchema,
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CandidateProfileSchema = z.object({
  summary: z.string(),
  skills: z.array(z.string().min(1)),
  yearsExperience: z.number().nonnegative(),
  currentRole: z.string().optional(),
  education: z.array(z.string()).optional(),
});

export const CandidateSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  cvUrl: z.string().min(1).optional(),
  profile: CandidateProfileSchema,
  score: z.number().min(0).max(100).optional(),
  status: CandidateStatusSchema,
  createdAt: z.string().datetime(),
});

export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;
export type CampaignCriteria = z.infer<typeof CampaignCriteriaSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
