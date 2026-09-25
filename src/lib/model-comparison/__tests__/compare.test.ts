import { describe, expect, it } from 'vitest';

import {
  aggregate,
  compareCv,
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

describe('verdict proposé', () => {
  const pairsOf = (n: number, delta = 1) =>
    Array.from({ length: n }, (_, i) => compareCv(ok(String(i), 60, 'gray', [v('1', 'satisfait')]), ok(String(i), 60 + delta, 'gray', [v('1', 'satisfait')])));

  it('ACCEPTABLE quand les cinq critères passent', () => {
    const r = proposeVerdict(aggregate(pairsOf(40)), 2, 0);
    expect(r.acceptable).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('(a) un seul basculement accepté ↔ refus suffit à refuser', () => {
    const pairs = [...pairsOf(99), compareCv(ok('x', 90, 'auto_accept', []), ok('x', 20, 'proposed_reject', []))];
    const r = proposeVerdict(aggregate(pairs), 60, 0);
    expect(r.acceptable).toBe(false);
    expect(r.checks.find((c) => c.id === 'a')!.passed).toBe(false);
  });

  it('(b) sans plancher de bruit, l’écart ne peut pas passer ; au-delà de bruit + 3, refusé', () => {
    expect(proposeVerdict(aggregate(pairsOf(40)), null, 0).checks.find((c) => c.id === 'b')!.passed).toBe(false);
    expect(proposeVerdict(aggregate(pairsOf(40, 6)), 2, 0).checks.find((c) => c.id === 'b')!.passed).toBe(false);
    expect(proposeVerdict(aggregate(pairsOf(40, 5)), 2, 0).checks.find((c) => c.id === 'b')!.passed).toBe(true);
  });

  it('(f) une analyse en échec chez le candidat empêche l’acceptation', () => {
    const r = proposeVerdict(aggregate(pairsOf(40)), 2, 1);
    expect(r.acceptable).toBe(false);
    expect(r.checks.at(-1)!.id).toBe('f');
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
      outcome,
      candidateLabel: 'gpt-4o-mini',
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
