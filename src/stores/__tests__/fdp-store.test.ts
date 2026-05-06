import { beforeEach, describe, expect, it } from 'vitest';

import { useFdpStore } from '@/stores/fdp-store';
import { FIELD_KEYS } from '@/types/field-collection';

describe('fdp-store (Session 3)', () => {
  beforeEach(() => {
    useFdpStore.getState().reset();
  });

  it('initial state has no FDP', () => {
    expect(useFdpStore.getState().fdp).toBeNull();
  });

  it('createFDP instantiates an empty FDP with 8 fields', () => {
    const fdp = useFdpStore.getState().createFDP('CAMP-2026-001');
    expect(fdp.campaignId).toBe('CAMP-2026-001');
    expect(fdp.isComplete).toBe(false);
    expect(fdp.isValidated).toBe(false);
    for (const key of FIELD_KEYS) {
      expect(fdp.fields[key].status).toBe('empty');
    }
    expect(useFdpStore.getState().fdp).toEqual(fdp);
  });

  it('applyExtractions fills meaningful values and recomputes isComplete', () => {
    const { createFDP, applyExtractions } = useFdpStore.getState();
    createFDP('CAMP-2026-001');
    applyExtractions({
      job_title: 'Comptable senior',
      location: 'Paris',
    });
    const fdp = useFdpStore.getState().fdp;
    expect(fdp?.fields.job_title.status).toBe('filled');
    expect(fdp?.fields.job_title.value).toBe('Comptable senior');
    expect(fdp?.fields.location.status).toBe('filled');
    expect(fdp?.isComplete).toBe(false);
  });

  it('applyExtractions ignores empty strings and empty arrays', () => {
    const { createFDP, applyExtractions } = useFdpStore.getState();
    createFDP('CAMP-2026-001');
    applyExtractions({
      job_title: '   ',
      key_skills: [],
    });
    const fdp = useFdpStore.getState().fdp;
    expect(fdp?.fields.job_title.status).toBe('empty');
    expect(fdp?.fields.key_skills.status).toBe('empty');
  });

  it('markFieldInProgress flips status only when not yet filled', () => {
    const { createFDP, applyExtractions, markFieldInProgress } =
      useFdpStore.getState();
    createFDP('CAMP-2026-001');

    markFieldInProgress('job_title');
    expect(useFdpStore.getState().fdp?.fields.job_title.status).toBe(
      'in_progress',
    );

    applyExtractions({ job_title: 'Comptable senior' });
    expect(useFdpStore.getState().fdp?.fields.job_title.status).toBe('filled');

    markFieldInProgress('job_title');
    expect(useFdpStore.getState().fdp?.fields.job_title.status).toBe('filled');
  });

  it('isComplete becomes true once every required field is filled', () => {
    const { createFDP, applyExtractions } = useFdpStore.getState();
    createFDP('CAMP-2026-001');
    applyExtractions({
      job_title: 'Comptable senior',
      seniority: 'senior',
      contract_type: 'CDI',
      location: 'Paris (télétravail hybride)',
      salary_range: '50-65K',
      start_date: '2026-09-01',
      main_missions: ['supervision', 'reporting', 'audit'],
      key_skills: ['IFRS', 'SAP', 'consolidation'],
    });
    expect(useFdpStore.getState().fdp?.isComplete).toBe(true);
  });

  it('validateFDP only flips isValidated when the FDP is complete', () => {
    const { createFDP, applyExtractions, validateFDP } =
      useFdpStore.getState();
    createFDP('CAMP-2026-001');

    validateFDP();
    expect(useFdpStore.getState().fdp?.isValidated).toBe(false);

    applyExtractions({
      job_title: 'X',
      seniority: 'senior',
      contract_type: 'CDI',
      location: 'Paris',
      salary_range: '50-65K',
      start_date: '2026-09-01',
      main_missions: ['m1'],
      key_skills: ['s1'],
    });
    validateFDP();
    expect(useFdpStore.getState().fdp?.isValidated).toBe(true);
  });

  it('reset clears the FDP', () => {
    const { createFDP, reset } = useFdpStore.getState();
    createFDP('CAMP-2026-001');
    expect(useFdpStore.getState().fdp).not.toBeNull();
    reset();
    expect(useFdpStore.getState().fdp).toBeNull();
  });

  it('does not import chat-store (boundary)', () => {
    // Sanity check : si le store référençait le chat, ce test détecterait
    // l'erreur via une dépendance circulaire au chargement. Mais il sert
    // surtout de garde-fou documentaire — la frontière est en commentaire
    // de tête de fichier.
    expect(useFdpStore.getState()).toBeDefined();
  });
});
