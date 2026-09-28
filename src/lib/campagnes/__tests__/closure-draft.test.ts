import { describe, expect, it } from 'vitest';

import {
  closureMissing,
  closureRequest,
  initialClosureDraft,
  notSelected,
  type ClosureDraft,
} from '@/lib/campagnes/closure-draft';

const R = (id: string) => ({ analysisId: id, uid: `u_${id}`, candidateName: id, hasEmail: true });
const RETENUS = [R('awa'), R('jean'), R('lea')];
const SELF = { mode: 'self', channel: 'telephone' } as const;

describe('dialogue de clôture — brouillon', () => {
  it('conclu pré-rempli s’il y a des retenus ; la DÉSIGNATION jamais', () => {
    const d = initialClosureDraft(true);
    expect(d.outcome).toBe('conclu');
    expect(d.hired).toBeNull();
    expect(closureMissing(d, RETENUS)).toEqual(['hired']);
  });

  it('non conclu : aucun changement de statut des retenus, aucun message', () => {
    const d: ClosureDraft = { ...initialClosureDraft(true), outcome: 'non_conclu' };
    expect(closureMissing(d, RETENUS)).toEqual([]);
    const req = closureRequest(d, RETENUS, 2)!;
    expect(req).toMatchObject({ hiredAnalysisId: null, notSelected: [], reason: 'campagne_cloturee' });
  });

  it('conclu sans préciser qui : possible, aucun retenu ne change, aucun message forcé', () => {
    const d: ClosureDraft = { ...initialClosureDraft(true), hired: { kind: 'unspecified' } };
    expect(closureMissing(d, RETENUS)).toEqual([]);
    expect(closureRequest(d, RETENUS, 0)).toMatchObject({
      hiredAnalysisId: null,
      notSelected: [],
      reason: 'poste_pourvu',
      dismissOpen: false,
    });
  });

  it('désignation : les AUTRES retenus sont non sélectionnés, chacun exige son message', () => {
    let d: ClosureDraft = {
      ...initialClosureDraft(true),
      hired: { kind: 'designated', analysisId: 'jean' },
    };
    expect(notSelected(d, RETENUS).map((r) => r.analysisId)).toEqual(['awa', 'lea']);
    expect(closureMissing(d, RETENUS)).toEqual(['feedback']);
    d = { ...d, feedbacks: { awa: SELF } };
    expect(closureRequest(d, RETENUS, 0)).toBeNull();
    d = { ...d, feedbacks: { awa: SELF, lea: SELF } };
    const req = closureRequest(d, RETENUS, 0)!;
    expect(req.hiredAnalysisId).toBe('jean');
    expect(req.notSelected).toEqual([
      { analysisId: 'awa', feedback: SELF },
      { analysisId: 'lea', feedback: SELF },
    ]);
  });

  it('un message saisi pour un retenu devenu le recruté ne part pas', () => {
    const d: ClosureDraft = {
      ...initialClosureDraft(true),
      hired: { kind: 'designated', analysisId: 'awa' },
      feedbacks: { awa: SELF, jean: SELF, lea: SELF },
    };
    expect(closureRequest(d, RETENUS, 0)!.notSelected.map((n) => n.analysisId)).toEqual([
      'jean',
      'lea',
    ]);
  });

  it('sans retenus : aucune désignation demandée', () => {
    const d = initialClosureDraft(false);
    expect(closureMissing(d, [])).toEqual(['outcome']);
    expect(closureMissing({ ...d, outcome: 'conclu' }, [])).toEqual([]);
  });
});
