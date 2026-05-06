import { describe, expect, it } from 'vitest';

import {
  buildEmptyFDP,
  computeIsComplete,
  ContractTypeSchema,
  FDPInProgressSchema,
  FIELD_KEYS,
  FIELD_LABELS,
  FieldKeySchema,
  FieldStatusSchema,
  SenioritySchema,
  type FieldKey,
  type FieldStatus,
} from '@/types/field-collection';
import {
  IntentClassificationSchema,
  IntentSchema,
} from '@/types/intent';
import {
  ChipPlacementSchema,
  ChipSetSchema,
  ManagerResponseSchema,
} from '@/types/manager-response';

describe('intent contracts', () => {
  it('accepts the five canonical intents', () => {
    for (const value of [
      'new_campaign',
      'campaign_followup',
      'out_of_campaign_task',
      'reporting_request',
      'other',
    ]) {
      expect(IntentSchema.parse(value)).toBe(value);
    }
  });

  it('rejects unknown intents', () => {
    expect(IntentSchema.safeParse('collect').success).toBe(false);
    expect(IntentSchema.safeParse('chitchat').success).toBe(false);
  });

  it('accepts a complete IntentClassification', () => {
    expect(
      IntentClassificationSchema.parse({
        intent: 'new_campaign',
        confidence: 0.94,
        reasoning: 'Le DRH demande explicitement un recrutement.',
        needsClarification: false,
      }),
    ).toBeDefined();
  });

  it('rejects confidence out of [0, 1]', () => {
    expect(
      IntentClassificationSchema.safeParse({
        intent: 'other',
        confidence: 1.5,
        reasoning: 'x',
        needsClarification: true,
      }).success,
    ).toBe(false);
  });

  it('rejects empty reasoning', () => {
    expect(
      IntentClassificationSchema.safeParse({
        intent: 'other',
        confidence: 0.5,
        reasoning: '',
        needsClarification: true,
      }).success,
    ).toBe(false);
  });
});

describe('field-collection contracts', () => {
  it('exposes the closed list of 8 field keys', () => {
    expect(FIELD_KEYS).toHaveLength(8);
    expect([...FIELD_KEYS].sort()).toEqual(
      [
        'job_title',
        'seniority',
        'contract_type',
        'location',
        'salary_range',
        'start_date',
        'main_missions',
        'key_skills',
      ].sort(),
    );
  });

  it('rejects field keys outside the closed list', () => {
    expect(FieldKeySchema.safeParse('experience_years').success).toBe(false);
    expect(FieldKeySchema.safeParse('budget').success).toBe(false);
    expect(FieldKeySchema.safeParse('remote').success).toBe(false);
  });

  it('exposes a label for each field key', () => {
    for (const key of FIELD_KEYS) {
      expect(FIELD_LABELS[key]).toBeDefined();
      expect(FIELD_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it('seniority and contract type enums match the spec', () => {
    for (const v of ['junior', 'confirmé', 'senior']) {
      expect(SenioritySchema.parse(v)).toBe(v);
    }
    for (const v of ['CDI', 'CDD', 'freelance', 'stage']) {
      expect(ContractTypeSchema.parse(v)).toBe(v);
    }
  });

  it('FieldStatus rejects unknown status values', () => {
    expect(
      FieldStatusSchema.safeParse({
        key: 'job_title',
        label: 'Intitulé',
        status: 'pending',
        required: true,
      }).success,
    ).toBe(false);
  });

  it('buildEmptyFDP creates an empty FDP with all 8 fields in status=empty', () => {
    const fdp = buildEmptyFDP('CAMP-2026-001');
    expect(fdp.campaignId).toBe('CAMP-2026-001');
    expect(fdp.isComplete).toBe(false);
    expect(fdp.isValidated).toBe(false);
    for (const key of FIELD_KEYS) {
      expect(fdp.fields[key].status).toBe('empty');
      expect(fdp.fields[key].required).toBe(true);
      expect(fdp.fields[key].value).toBeUndefined();
    }
    expect(FDPInProgressSchema.parse(fdp)).toBeDefined();
  });

  it('computeIsComplete is true only when all required fields are filled', () => {
    const fdp = buildEmptyFDP('CAMP-2026-001');
    expect(computeIsComplete(fdp.fields)).toBe(false);
    const filled = {} as Record<FieldKey, FieldStatus>;
    for (const key of FIELD_KEYS) {
      filled[key] = { ...fdp.fields[key], status: 'filled', value: 'x' };
    }
    expect(computeIsComplete(filled)).toBe(true);
  });

  it('computeIsComplete returns false if any required field is in_progress', () => {
    const fdp = buildEmptyFDP('CAMP-2026-001');
    const fields = { ...fdp.fields };
    for (const key of FIELD_KEYS) {
      fields[key] = { ...fields[key], status: 'filled', value: 'x' };
    }
    fields.start_date = { ...fields.start_date, status: 'in_progress' };
    expect(computeIsComplete(fields)).toBe(false);
  });
});

describe('manager-response contracts', () => {
  it('accepts the three placements', () => {
    for (const v of ['below_bubble', 'above_input', 'inline']) {
      expect(ChipPlacementSchema.parse(v)).toBe(v);
    }
  });

  it('rejects ChipSet with fewer than 2 options', () => {
    expect(
      ChipSetSchema.safeParse({
        placement: 'below_bubble',
        options: ['CDI'],
      }).success,
    ).toBe(false);
  });

  it('rejects ChipSet with more than 5 options', () => {
    expect(
      ChipSetSchema.safeParse({
        placement: 'below_bubble',
        options: ['a', 'b', 'c', 'd', 'e', 'f'],
      }).success,
    ).toBe(false);
  });

  it('accepts a ManagerResponse with no chips and no extractions', () => {
    expect(
      ManagerResponseSchema.parse({
        message: 'Quelles sont les missions principales ?',
      }),
    ).toBeDefined();
  });

  it('accepts a ManagerResponse with chips and partial extractions', () => {
    const parsed = ManagerResponseSchema.parse({
      message: 'Quel type de contrat ?',
      chips: {
        placement: 'below_bubble',
        options: ['CDI', 'CDD', 'Freelance', 'Stage'],
      },
      fieldExtractions: {
        job_title: 'Comptable senior',
        location: 'Paris',
      },
    });
    expect(parsed.chips?.options).toHaveLength(4);
    expect(parsed.fieldExtractions?.job_title).toBe('Comptable senior');
  });

  it('rejects fieldExtractions with unknown keys', () => {
    expect(
      ManagerResponseSchema.safeParse({
        message: 'x',
        fieldExtractions: { budget: '50K' },
      }).success,
    ).toBe(false);
  });
});
