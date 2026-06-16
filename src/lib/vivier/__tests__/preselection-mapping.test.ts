import { describe, expect, it } from 'vitest';

import {
  campaignTitleTermSet,
  firstDeterministicMatch,
  freshnessFactor,
  normalizeTitleTerm,
} from '@/lib/vivier/preselection';

describe('normalizeTitleTerm', () => {
  it('trim + minuscules + espaces compactés', () => {
    expect(normalizeTitleTerm('  QA   Lead ')).toBe('qa lead');
  });
});

describe('campaignTitleTermSet', () => {
  it('réunit intitulé + variantes, normalisés, sans vides', () => {
    const set = campaignTitleTermSet(['Test Manager'], ['QA Lead', '', '  ']);
    expect([...set].sort()).toEqual(['qa lead', 'test manager']);
  });
});

describe('firstDeterministicMatch', () => {
  const campaign = campaignTitleTermSet(['Test Manager'], ['QA Lead', 'QA Manager']);

  it('matche via le titre candidat (casse/espaces ignorés), renvoie le terme original', () => {
    expect(firstDeterministicMatch('test manager', [], campaign)).toBe('test manager');
  });

  it('matche via une variante candidate', () => {
    expect(firstDeterministicMatch('Lead QA', ['QA Lead'], campaign)).toBe('QA Lead');
  });

  it('hors-domaine ⇒ null', () => {
    expect(firstDeterministicMatch('Directeur Commercial', ['Sales Director'], campaign)).toBeNull();
  });

  it('titre null sans variante ⇒ null', () => {
    expect(firstDeterministicMatch(null, [], campaign)).toBeNull();
  });
});

describe('freshnessFactor', () => {
  const now = Date.parse('2027-12-01T00:00:00Z');
  it('récent ⇒ 1 ; très ancien ⇒ plancher 0.5 ; illisible ⇒ 1', () => {
    expect(freshnessFactor('2027-06-01T00:00:00Z', now)).toBe(1);
    expect(freshnessFactor('2020-01-01T00:00:00Z', now)).toBe(0.5);
    expect(freshnessFactor('pas-une-date', now)).toBe(1);
  });
});
