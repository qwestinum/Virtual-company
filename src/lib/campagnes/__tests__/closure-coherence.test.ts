import { describe, expect, it } from 'vitest';

import { findIncompleteClosures } from '@/lib/campagnes/closure-coherence';

const uidOf = (id: string) => (id === 'purge' ? null : `u_${id}`);
const closed = (campaignId: string, payload: Record<string, unknown>, createdAt = '2026-09-28T10:00:00Z') => ({
  campaignId,
  payload,
  createdAt,
});
const hired = (campaignId: string, id: string, status = 'hired') => ({
  action: 'candidate_hired_marked',
  campaignId,
  payload: { uid: `u_${id}`, status },
});
const notSelected = (campaignId: string, id: string) => ({
  action: 'candidate_validation_marked',
  campaignId,
  payload: { uid: `u_${id}`, status: 'rejected', cause: 'not_selected_at_closure' },
});

describe('clôture incomplète', () => {
  const CLOSURE = closed('C1', { outcome: 'conclu', hiredAnalysisId: 'jean', notSelectedAnalysisIds: ['awa', 'lea'] });

  it('tous les marqueurs posés ⇒ rien à signaler', () => {
    const markers = [hired('C1', 'jean'), notSelected('C1', 'awa'), notSelected('C1', 'lea')];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)).toEqual([]);
  });

  it('recruté annoncé sans marqueur ⇒ signalé', () => {
    const markers = [notSelected('C1', 'awa'), notSelected('C1', 'lea')];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)).toEqual([
      { campaignId: 'C1', missingHire: true, missingNotSelected: [] },
    ]);
  });

  it('non-sélectionné sans son verdict de clôture ⇒ signalé, nommément', () => {
    const markers = [hired('C1', 'jean'), notSelected('C1', 'awa')];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)).toEqual([
      { campaignId: 'C1', missingHire: false, missingNotSelected: ['lea'] },
    ]);
  });

  it('un verdict « rejected » SANS la cause de clôture ne compte pas', () => {
    const markers = [
      hired('C1', 'jean'),
      notSelected('C1', 'awa'),
      { action: 'candidate_validation_marked', campaignId: 'C1', payload: { uid: 'u_lea', status: 'rejected' } },
    ];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)[0]?.missingNotSelected).toEqual(['lea']);
  });

  it('« Annuler la désignation » (gomme) n’est PAS une clôture incomplète', () => {
    const markers = [hired('C1', 'jean'), hired('C1', 'jean', 'cleared'), notSelected('C1', 'awa'), notSelected('C1', 'lea')];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)).toEqual([]);
  });

  it('le doute ne conclut pas : une candidature purgée n’est pas comptée', () => {
    const c = closed('C1', { outcome: 'conclu', hiredAnalysisId: 'purge', notSelectedAnalysisIds: ['purge'] });
    expect(findIncompleteClosures([c], uidOf, [])).toEqual([]);
  });

  it('seule la clôture la PLUS RÉCENTE d’une campagne compte', () => {
    const ancienne = closed('C1', { outcome: 'conclu', hiredAnalysisId: 'jean' }, '2026-09-01T10:00:00Z');
    const recente = closed('C1', { outcome: 'non_conclu', hiredAnalysisId: null }, '2026-09-20T10:00:00Z');
    expect(findIncompleteClosures([recente, ancienne], uidOf, [])).toEqual([]);
  });

  it('une clôture sans désignation n’annonce rien, donc ne manque de rien', () => {
    expect(findIncompleteClosures([closed('C2', { outcome: 'non_conclu', hiredAnalysisId: null })], uidOf, [])).toEqual([]);
  });

  it('les marqueurs d’une AUTRE campagne ne comblent pas le manque', () => {
    const markers = [hired('C9', 'jean'), notSelected('C9', 'awa'), notSelected('C9', 'lea')];
    expect(findIncompleteClosures([CLOSURE], uidOf, markers)[0]).toMatchObject({ missingHire: true });
  });
});

describe('plusieurs recrutés (28/09/2026)', () => {
  it('un des recrutés annoncés sans son marqueur ⇒ signalé', () => {
    const c = closed('C1', { outcome: 'conclu', hiredAnalysisIds: ['jean', 'awa'], notSelectedAnalysisIds: [] });
    expect(findIncompleteClosures([c], uidOf, [hired('C1', 'jean')])).toEqual([
      { campaignId: 'C1', missingHire: true, missingNotSelected: [] },
    ]);
    expect(findIncompleteClosures([c], uidOf, [hired('C1', 'jean'), hired('C1', 'awa')])).toEqual([]);
  });
});
