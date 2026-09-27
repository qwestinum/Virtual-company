/**
 * La vérification d'un BROUILLON : chaque champ manquant est NOMMÉ, et le
 * reste de l'offre est vérifié dans le même passage — jamais un « certains
 * champs manquent » qui laisse deviner lesquels.
 */
import { describe, expect, it } from 'vitest';

import {
  apecSectionOf,
  checkAdepDraft,
  errorsByField,
  isApecFieldRequired,
} from '../draft-check';
import type { AdepDraftOffer } from '../mapping';
import { SAMPLE_OFFER, SAMPLE_TODAY } from './fixtures/sample-offer';

const draft = (patch: Partial<AdepDraftOffer> = {}): AdepDraftOffer => ({
  ...SAMPLE_OFFER,
  ...patch,
});

describe('checkAdepDraft', () => {
  it('rend zéro erreur sur une offre complète et valide', () => {
    expect(checkAdepDraft(draft(), SAMPLE_TODAY).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('NOMME chaque champ manquant, un par ligne, rattaché à son champ', () => {
    const issues = checkAdepDraft(draft({ statusJob: null, inseeCode: null }), SAMPLE_TODAY);
    const byField = errorsByField(issues);
    expect(byField.get('statusJob')).toContain('Statut du poste');
    expect(byField.get('inseeCode')).toContain('code INSEE');
    expect(issues.some((i) => i.field === 'draft')).toBe(false);
    expect(issues.some((i) => /certains champs/i.test(i.message))).toBe(false);
  });

  it('vérifie le RESTE de l’offre dans le même passage', () => {
    const issues = checkAdepDraft(
      draft({ jobType: null, positionTitle: '' }),
      SAMPLE_TODAY,
    );
    const fields = issues.filter((i) => i.level === 'error').map((i) => i.field);
    expect(fields).toContain('jobType');
    expect(fields).toContain('positionTitle');
  });

  it('ne signale rien sur les valeurs de bouchage des champs vides', () => {
    // Contrat vide : aucune remarque de durée ne doit en découler.
    const issues = checkAdepDraft(draft({ jobType: null, durationMonths: 12 }), SAMPLE_TODAY);
    expect(issues.filter((i) => i.field === 'jobType')).toHaveLength(1);
    expect(issues.some((i) => i.field === 'durationMonths')).toBe(false);
  });
});

describe('isApecFieldRequired', () => {
  it('suit les règles du validateur', () => {
    expect(isApecFieldRequired('inseeCode', draft())).toBe(true);
    expect(isApecFieldRequired('remoteWork', draft())).toBe(false);
    expect(isApecFieldRequired('durationMonths', draft({ jobType: '1' }))).toBe(false);
    expect(isApecFieldRequired('durationMonths', draft({ jobType: '5' }))).toBe(true);
    expect(isApecFieldRequired('salaryMin', draft({ jobType: '9' }))).toBe(false);
    expect(isApecFieldRequired('salaryMin', draft({ jobType: '1' }))).toBe(true);
    expect(isApecFieldRequired('partTimeDuration', draft({ partTime: false }))).toBe(false);
    expect(isApecFieldRequired('partTimeDuration', draft({ partTime: true }))).toBe(true);
  });
});

describe('apecSectionOf', () => {
  it('range chaque champ dans sa section', () => {
    expect(apecSectionOf('positionDescription')).toBe('annonce');
    expect(apecSectionOf('inseeCode')).toBe('exigences');
    expect(apecSectionOf('clientPositionId')).toBeNull();
  });
});
