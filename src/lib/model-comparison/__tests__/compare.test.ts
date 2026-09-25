import { describe, expect, it } from 'vitest';

import {
  aggregate,
  compareCv,
  evidenceOf,
  isSameModel,
  pairArms,
  proposeVerdict,
  quoteFoundInCv,
  rankDisagreements,
  zoneBucket,
} from '@/lib/model-comparison/compare';
import { computeOutcome, renderCsv, renderReport, summarizeArm } from '@/lib/model-comparison/report';
import type { ArmRecord, ArmSuccess, ArmVerdict } from '@/lib/model-comparison/types';

const v = (criterionId: string, decision: ArmVerdict['decision'], quoteFound: boolean | null = true): ArmVerdict => ({
  criterionId,
  label: `Critère ${criterionId}`,
  level: 'important',
  decision,
  quote: 'CITATION-SECRETE Jeanne Martin',
  justification: 'JUSTIF-SECRETE',
  quoteFound,
});

const ok = (id: string, score: number, zone: ArmSuccess['zone'], verdicts: ArmVerdict[], over: Partial<ArmSuccess> = {}): ArmSuccess => ({
  ok: true,
  analysisId: id,
  campaignId: 'CAMP-2026-001',
  score,
  zone,
  verdicts,
  knockoutsFailed: [],
  durationMs: 20_000,
  promptTokens: 10_000,
  completionTokens: 2_000,
  costUsd: 0.05,
  models: ['gpt-4o-2024-08-06'],
  ...over,
});

describe('zones', () => {
  it('auto_reject (legacy) se range avec le refus proposé', () => {
    expect(zoneBucket('auto_reject')).toBe('reject');
    expect(zoneBucket('proposed_reject')).toBe('reject');
    expect(zoneBucket('gray')).toBe('gray');
    expect(zoneBucket('auto_accept')).toBe('accept');
  });
});

describe('citations « mot pour mot »', () => {
  const cv = 'Consultant SI & AMOA — 4 ans.\nPilotage   de la recette ; l’équipe « Trade Finance ».';
  it('tolère casse, espaces et typographie ; un mot différent reste différent', () => {
    expect(quoteFoundInCv('pilotage de la recette', cv)).toBe(true);
    expect(quoteFoundInCv("l'équipe \"Trade Finance\"", cv)).toBe(true);
    expect(quoteFoundInCv('Consultant SI & AMOA - 4 ans', cv)).toBe(true);
    expect(quoteFoundInCv('Consultant MOA', cv)).toBe(false);
  });
  it('ligatures PDF et ponctuation finale ajoutée par le modèle ne sont pas des écarts', () => {
    expect(quoteFoundInCv('Définition du besoin', 'Déﬁnition du besoin client')).toBe(true);
    expect(quoteFoundInCv('Pilotage de la recette.', cv)).toBe(true);
    expect(quoteFoundInCv('- Pilotage de la recette', cv)).toBe(true);
    // …mais un mot changé reste un écart.
    expect(quoteFoundInCv('Pilotage de la qualification.', cv)).toBe(false);
  });

  it('ellipse : chaque fragment doit se trouver ; citation vide ⇒ rien à vérifier', () => {
    expect(quoteFoundInCv('Consultant SI … Trade Finance', cv)).toBe(true);
    expect(quoteFoundInCv('Consultant SI ... Private Equity', cv)).toBe(false);
    expect(quoteFoundInCv('', cv)).toBeNull();
    expect(quoteFoundInCv('  «  »  ', cv)).toBeNull();
  });
});

describe('comparaison d’un CV', () => {
  it('compte les accords, le « non vérifiable » devenu « non », les citations introuvables', () => {
    const ref = ok('a', 80, 'auto_accept', [v('1', 'satisfait'), v('2', 'non_verifiable'), v('3', 'partiel')]);
    const cand = ok('a', 40, 'proposed_reject', [v('1', 'satisfait'), v('2', 'non'), v('3', 'partiel', false)]);
    const c = compareCv(ref, cand);
    expect(c).toMatchObject({
      deltaScore: -40, zoneSame: false, flip: true, criteriaCompared: 3, criteriaAgreeing: 2,
      nonVerifiableToNon: 1, quotesChecked: 3, quotesInvalid: 1, knockoutsAgree: true,
    });
    expect(c.disagreeingCriteria).toEqual([{ criterionId: '2', label: 'Critère 2', ref: 'non_verifiable', other: 'non' }]);
  });

  it('les rédhibitoires se comparent comme ENSEMBLES', () => {
    const ref = ok('a', 50, 'proposed_reject', [], { knockoutsFailed: ['k1', 'k2'] });
    expect(compareCv(ref, ok('a', 50, 'proposed_reject', [], { knockoutsFailed: ['k2', 'k1'] })).knockoutsAgree).toBe(true);
    expect(compareCv(ref, ok('a', 50, 'proposed_reject', [], { knockoutsFailed: ['k1'] })).knockoutsAgree).toBe(false);
  });

  it('un échec n’est jamais comparé : il est rendu à part', () => {
    const ref: ArmRecord[] = [ok('a', 80, 'gray', []), { ok: false, analysisId: 'b', campaignId: 'C', kind: 'transport', message: 'x', durationMs: 1 }, ok('c', 70, 'gray', [])];
    const cand: ArmRecord[] = [{ ok: false, analysisId: 'a', campaignId: 'C', kind: 'analysis_unavailable', message: 'x', durationMs: 1 }, ok('b', 1, 'gray', [])];
    expect(pairArms(ref, cand)).toMatchObject({ pairs: [], refFailed: ['b'], otherFailed: ['a'], missing: ['c'] });
  });
});

describe('verdict proposé — tout seuil relatif au plancher de bruit du run', () => {
  const pairsOf = (n: number, delta = 1, zone: ArmSuccess['zone'] = 'gray', otherZone: ArmSuccess['zone'] = zone) =>
    Array.from({ length: n }, (_, i) => compareCv(ok(String(i), 60, zone, [v('1', 'satisfait')]), ok(String(i), 60 + delta, otherZone, [v('1', 'satisfait')])));
  // Bruit : 20 CV, Δ 2, accord de zone 90 % (2 dossiers changent de zone).
  const noise = aggregate([...pairsOf(18, 2), ...pairsOf(2, 2, 'gray', 'proposed_reject')]);

  it('ACCEPTABLE quand chaque critère tient face au bruit', () => {
    const r = proposeVerdict(aggregate(pairsOf(40)), noise, 0);
    expect(r.acceptable).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('(b) 89 % d’accord de zone PASSE quand gpt-4o lui-même n’en fait que 90 % — le seuil absolu de 95 % l’aurait refusé', () => {
    const cand = aggregate([...pairsOf(89), ...pairsOf(11, 1, 'gray', 'proposed_reject')]);
    expect(cand.zoneAgreement).toBeCloseTo(0.89);
    expect(proposeVerdict(cand, noise, 0).checks.find((c) => c.id === 'b')!.passed).toBe(true);
    // 86 % : plus de 3 points sous le bruit.
    const worse = aggregate([...pairsOf(86), ...pairsOf(14, 1, 'gray', 'proposed_reject')]);
    expect(proposeVerdict(worse, noise, 0).checks.find((c) => c.id === 'b')!.passed).toBe(false);
  });

  it('(b) écart de score : plafond = bruit + 3', () => {
    expect(proposeVerdict(aggregate(pairsOf(40, 5)), noise, 0).checks.find((c) => c.id === 'b')!.passed).toBe(true);
    expect(proposeVerdict(aggregate(pairsOf(40, 6)), noise, 0).checks.find((c) => c.id === 'b')!.passed).toBe(false);
  });

  it('(a) un basculement accepté ↔ refus refuse, tant que le bruit n’en fait aucun', () => {
    const pairs = [...pairsOf(99), compareCv(ok('x', 90, 'auto_accept', []), ok('x', 20, 'proposed_reject', []))];
    const r = proposeVerdict(aggregate(pairs), noise, 0);
    expect(r.checks.find((c) => c.id === 'a')!.passed).toBe(false);
  });

  it('sans bras de bruit, les critères relatifs au bruit ÉCHOUENT (aucun plancher)', () => {
    const r = proposeVerdict(aggregate(pairsOf(40)), null, 0);
    expect(r.acceptable).toBe(false);
    expect(r.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('(e) pas plus de 2 points au-dessus de la RÉFÉRENCE du même run', () => {
    const verdictsWith = (unproven: number) => Array.from({ length: 10 }, (_, i) => v(String(i), 'satisfait', i >= unproven));
    const pairs = (candUnprovenPerCv: number[]) =>
      candUnprovenPerCv.map((u, i) => compareCv(ok(String(i), 60, 'gray', verdictsWith(1)), ok(String(i), 60, 'gray', verdictsWith(u))));
    expect(proposeVerdict(aggregate(pairs([2, 2, 1, 1, 1, 1, 1, 1, 1, 1])), noise, 0).checks.find((c) => c.id === 'e')!.passed).toBe(true);
    expect(proposeVerdict(aggregate(pairs([2, 2, 2, 1, 1, 1, 1, 1, 1, 1])), noise, 0).checks.find((c) => c.id === 'e')!.passed).toBe(false);
  });

  it('les preuves se lisent sur la rétrogradation (depuis la garde) ou sur la citation (avant)', () => {
    const downgraded: ArmVerdict = { ...v('1', 'non_verifiable', null), evidenceDowngrade: { from: 'satisfait', reason: 'quote_not_found' } };
    expect(evidenceOf([downgraded, v('2', 'satisfait', true), v('3', 'partiel', false), v('4', 'non', null), v('5', 'non_verifiable', null)])).toEqual({
      positives: 3,
      unproven: 2,
    });
  });

  it('(f) plus d’échecs que la référence : non comparés, verdict refusé', () => {
    expect(proposeVerdict(aggregate(pairsOf(40)), noise, 1, 0).checks.at(-1)!.id).toBe('f');
    expect(proposeVerdict(aggregate(pairsOf(40)), noise, 1, 1).acceptable).toBe(true);
  });
});

describe('désaccords classés par gravité', () => {
  it('bascules, puis zones, puis rédhibitoires, puis nv→non, puis citations ; le plus grand écart d’abord', () => {
    const pairs = [
      compareCv(ok('cit', 60, 'gray', [v('1', 'satisfait')]), ok('cit', 60, 'gray', [v('1', 'satisfait', false)])),
      compareCv(ok('zone', 70, 'gray', []), ok('zone', 50, 'proposed_reject', [])),
      compareCv(ok('flip', 90, 'auto_accept', []), ok('flip', 10, 'proposed_reject', [])),
      compareCv(ok('nv', 60, 'gray', [v('1', 'non_verifiable')]), ok('nv', 60, 'gray', [v('1', 'non')])),
      compareCv(ok('ko', 40, 'proposed_reject', [], { knockoutsFailed: ['k'] }), ok('ko', 40, 'proposed_reject', [])),
      compareCv(ok('same', 60, 'gray', []), ok('same', 61, 'gray', [])),
      compareCv(ok('zone2', 70, 'gray', []), ok('zone2', 85, 'auto_accept', [])),
    ];
    expect(rankDisagreements(pairs).map((p) => p.analysisId)).toEqual(['flip', 'zone', 'zone2', 'ko', 'nv', 'cit']);
  });
});

describe('modèle renvoyé', () => {
  it('égalité ou suffixe de date seulement — gpt-4o-mini daté n’est PAS gpt-4o', () => {
    expect(isSameModel('gpt-4o', 'gpt-4o-2024-08-06')).toBe(true);
    expect(isSameModel('gpt-4o-mini', 'gpt-4o-mini-2024-07-18')).toBe(true);
    expect(isSameModel('gpt-4o', 'gpt-4o-mini-2024-07-18')).toBe(false);
    expect(isSameModel('claude-sonnet-4-6', 'claude-sonnet-4-6-20250929')).toBe(true);
    expect(isSameModel('mistral-large-latest', 'mistral-large-2411')).toBe(false);
  });
});

describe('rapport', () => {
  it('ne contient AUCUNE citation ni justification, même quand les enregistrements en portent', () => {
    const ref: ArmRecord[] = [ok('a', 80, 'auto_accept', [v('1', 'satisfait')]), ok('b', 55, 'gray', [v('1', 'non_verifiable')])];
    const cand: ArmRecord[] = [ok('a', 20, 'proposed_reject', [v('1', 'non', false)]), ok('b', 55, 'gray', [v('1', 'non')])];
    const outcome = computeOutcome(ref, cand, ref);
    const md = renderReport({
      generatedAt: '2026-09-25',
      projectRef: 'dev',
      sample: { eligible: 2, selected: 2, excluded: {}, sentinelsRequested: 0, sentinelsFound: 0 },
      arms: [summarizeArm('référence', { provider: 'openai', requestedModel: 'gpt-4o', baseUrl: null }, ref)],
      candidates: [{ label: 'gpt-4o-mini', outcome }],
    });
    const csv = renderCsv(outcome.candidate.pairs, ref, cand);
    for (const out of [md, csv]) {
      expect(out).not.toMatch(/CITATION-SECRETE|JUSTIF-SECRETE|Jeanne|Martin/);
    }
    expect(md).toContain('REFUSÉ');
    expect(md).toContain('Basculement accepté ↔ refus');
    expect(outcome.noiseFloor).toBe(0); // la référence contre elle-même
    expect(csv.split('\n')[0]).toContain('cand_models');
  });
});
