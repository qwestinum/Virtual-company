/**
 * Le vocabulaire des marqueurs et sa GOMME (`cleared`).
 *
 * Le défaut qu'on verrouille ici est précis : un filtre sur la VALEUR placé
 * avant la comparaison de DATES fait gagner le marqueur antérieur — la
 * correction est alors silencieusement ignorée, et l'écran continue d'afficher
 * la décision qu'on vient de retirer.
 */
import { describe, expect, it } from 'vitest';

import {
  buildInterviewMarkerEntry,
  buildValidationMarkerEntry,
  describeInterviewMark,
  describeValidationMark,
  emptyInterviewState,
  emptyValidationState,
  foldInterviewMark,
  foldValidationMark,
  interviewMarkEffect,
  readInterviewMark,
  readValidationMark,
  validationMarkEffect,
  type InterviewMarkValue,
  type ValidationMarkValue,
} from '@/lib/candidatures/decision-markers';

const T0 = '2026-08-21T14:32:00.000Z';
const T1 = '2026-08-22T09:00:00.000Z';
const T2 = '2026-08-22T11:00:00.000Z';

describe('effets — la gomme ne dérive vers aucune étape', () => {
  it('entretien', () => {
    expect(interviewMarkEffect('realized')).toBe('realized');
    expect(interviewMarkEffect('missed')).toBe('missed');
    expect(interviewMarkEffect('cleared')).toBeNull();
  });

  it('verdict final', () => {
    expect(validationMarkEffect('validated')).toBe('validated');
    expect(validationMarkEffect('rejected')).toBe('rejected');
    expect(validationMarkEffect('cleared')).toBeNull();
  });

  it('toutes les valeurs ont un libellé (aucun `else` fourre-tout)', () => {
    const interview: InterviewMarkValue[] = ['realized', 'missed', 'cleared'];
    const validation: ValidationMarkValue[] = ['validated', 'rejected', 'cleared'];
    for (const v of interview) {
      expect(describeInterviewMark(v).label.length).toBeGreaterThan(0);
    }
    for (const v of validation) {
      expect(describeValidationMark(v).label.length).toBeGreaterThan(0);
    }
    // La gomme ne doit JAMAIS se lire comme un refus.
    expect(describeInterviewMark('cleared').tone).toBe('neutral');
    expect(describeValidationMark('cleared').tone).toBe('neutral');
  });
});

describe('lecture défensive', () => {
  it('rend null sur un payload inconnu ou vide', () => {
    expect(readInterviewMark({ status: 'bidon' })).toBeNull();
    expect(readInterviewMark({})).toBeNull();
    expect(readInterviewMark(undefined)).toBeNull();
    expect(readValidationMark({ status: 42 })).toBeNull();
  });
});

describe('dernier-gagne — la date prime, PUIS la valeur', () => {
  it('une gomme postérieure retire le marquage', () => {
    let state = emptyInterviewState();
    state = foldInterviewMark(state, { status: 'realized' }, T0);
    expect(state.effect).toBe('realized');
    state = foldInterviewMark(state, { status: 'cleared' }, T1);
    expect(state.effect).toBeNull();
    expect(state.at).toBe(T1);
  });

  it('un marquage ANTÉRIEUR ne reprend jamais la main après une gomme', () => {
    // Ordre d'itération DESC (celui du journal) : la gomme arrive d'abord.
    let state = emptyInterviewState();
    state = foldInterviewMark(state, { status: 'cleared' }, T1);
    state = foldInterviewMark(state, { status: 'realized' }, T0);
    expect(state.effect).toBeNull();
  });

  it('corriger DEUX fois de suite : le dernier gagne, sans état bâtard', () => {
    let state = emptyValidationState();
    state = foldValidationMark(state, { status: 'rejected' }, T0);
    state = foldValidationMark(state, { status: 'validated' }, T1);
    state = foldValidationMark(state, { status: 'cleared' }, T2);
    expect(state.effect).toBeNull();
    expect(state.at).toBe(T2);
  });

  it('un payload illisible laisse l’état intact', () => {
    let state = emptyValidationState();
    state = foldValidationMark(state, { status: 'validated' }, T0);
    state = foldValidationMark(state, { status: 'n’importe quoi' }, T2);
    expect(state.effect).toBe('validated');
    expect(state.at).toBe(T0);
  });
});

describe('écriture — un seul payload, action normale ou correction', () => {
  it('même forme, la correction ajoute seulement sa trace', () => {
    const normal = buildInterviewMarkerEntry({
      uid: 'u1',
      candidateName: 'Malaka Diarra',
      campaignId: 'CAMP-2026-288',
      value: 'realized',
    });
    const corrected = buildInterviewMarkerEntry({
      uid: 'u1',
      candidateName: 'Malaka Diarra',
      campaignId: 'CAMP-2026-288',
      value: 'cleared',
      corrected: true,
    });
    expect(normal.action).toBe(corrected.action);
    expect(normal.payload).toEqual({
      uid: 'u1',
      candidate: 'Malaka Diarra',
      status: 'realized',
    });
    expect(corrected.payload.corrected).toBe(true);
    expect(corrected.payload.status).toBe('cleared');
  });

  it('le verdict suit la même règle', () => {
    const entry = buildValidationMarkerEntry({
      uid: 'u2',
      candidateName: 'Sarah D.',
      campaignId: null,
      value: 'cleared',
      corrected: true,
    });
    expect(readValidationMark(entry.payload)).toBe('cleared');
    expect(entry.campaignId).toBeNull();
  });
});
