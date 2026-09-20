import { describe, expect, it } from 'vitest';

import { buildTodayBoard, TODAY_SECTION_LIMIT } from '@/lib/today/board';
import type { TodayInput } from '@/lib/today/board';
import type { PendingValidation } from '@/types/hitl';
import type { BusinessSignal } from '@/types/notifications';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ilYA = (jours: number) =>
  new Date(NOW - jours * 86_400_000).toISOString();

function validation(over: Partial<PendingValidation> = {}): PendingValidation {
  return {
    id: 'val_1',
    campaignId: 'CAMP-2026-221',
    candidateName: 'Mila Renard',
    candidateEmail: 'mila@exemple.fr',
    score: 72,
    decision: 'accept',
    cvArtifactId: null,
    reportArtifactId: null,
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: {},
    createdAt: ilYA(9),
    updatedAt: ilYA(9),
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
    ...over,
  };
}

function input(over: Partial<TodayInput> = {}): TodayInput {
  return {
    validations: [],
    zoneByValidation: {},
    coherenceByValidation: {},
    scheduled: [],
    verdict: [],
    signals: [],
    nowMs: NOW,
    ...over,
  };
}

const signal = (over: Partial<BusinessSignal>): BusinessSignal =>
  ({
    key: 'availability_holidays_unblocked',
    count: 4,
    oldestDays: 0,
    message: '4 jours fériés restent proposables',
    ctaLabel: 'Ouvrir mes disponibilités',
    target: { route: '/settings' },
    ...over,
  }) as BusinessSignal;

describe('à zéro — une phrase, jamais quatre cartes vides', () => {
  it('tout est vide → allClear', () => {
    const board = buildTodayBoard(input());
    expect(board.allClear).toBe(true);
    expect(board.decide.items).toEqual([]);
    expect(board.interviews.items).toEqual([]);
    expect(board.verify.items).toEqual([]);
    expect(board.proposals.total).toBe(0);
  });

  it('une seule chose quelque part suffit à sortir de « allClear »', () => {
    expect(
      buildTodayBoard(input({ signals: [signal({})] })).allClear,
    ).toBe(false);
    expect(
      buildTodayBoard(
        input({
          validations: [validation()],
          zoneByValidation: { val_1: 'gray' },
        }),
      ).allClear,
    ).toBe(false);
  });
});

describe('la partition est celle de la file d’arbitrage', () => {
  it('« gray » va à décider, « proposed_reject » aux propositions', () => {
    const board = buildTodayBoard(
      input({
        validations: [
          validation({ id: 'a', createdAt: ilYA(9) }),
          validation({ id: 'b', createdAt: ilYA(31), decision: 'reject' }),
        ],
        zoneByValidation: { a: 'gray', b: 'proposed_reject' },
      }),
    );
    expect(board.decide.total).toBe(1);
    expect(board.decide.items[0]?.id).toBe('a');
    expect(board.proposals.total).toBe(1);
    expect(board.proposals.oldestDays).toBe(31);
  });

  it('la zone NE SUFFIT PAS : il faut aussi un brouillon de refus', () => {
    // Piège rencontré en écrivant ce test : une candidature en zone
    // `proposed_reject` dont le brouillon porte une ACCEPTATION n'est pas une
    // proposition de refus. Proposer de la refuser en fournée enverrait un
    // refus là où le dossier préparait l'inverse.
    const board = buildTodayBoard(
      input({
        validations: [validation({ id: 'a', decision: 'accept' })],
        zoneByValidation: { a: 'proposed_reject' },
      }),
    );
    expect(board.proposals.total).toBe(0);
    expect(board.decide.total).toBe(1);
  });

  it('une zone absente reste « à examiner » — on ne propose pas un refus sur une donnée qu’on n’a pas', () => {
    const board = buildTodayBoard(
      input({ validations: [validation({ id: 'a' })], zoneByValidation: {} }),
    );
    expect(board.decide.total).toBe(1);
    expect(board.proposals.total).toBe(0);
  });
});

describe('un dossier indécidable n’est JAMAIS proposé', () => {
  it('une fiche désarmée sort des deux sections', () => {
    // Elle n'est pas perdue : le signal `validations_incoherentes` la compte,
    // et ce signal vit en « À vérifier ».
    const board = buildTodayBoard(
      input({
        validations: [
          validation({ id: 'a' }),
          validation({ id: 'b', decision: 'reject' }),
        ],
        zoneByValidation: { a: 'gray', b: 'proposed_reject' },
        coherenceByValidation: {
          a: { kind: 'settled', reason: 'decided' },
          b: { kind: 'settled', reason: 'decided' },
        },
      }),
    );
    expect(board.decide.total).toBe(0);
    expect(board.proposals.total).toBe(0);
    expect(board.allClear).toBe(true);
  });
});

describe('chaque ligne mène à la vue filtrée annoncée', () => {
  it('un dossier à décider mène à SA campagne, filtrée « à valider »', () => {
    const board = buildTodayBoard(
      input({
        validations: [validation({ id: 'a', campaignId: 'CAMP-2026-991' })],
        zoneByValidation: { a: 'gray' },
      }),
    );
    expect(board.decide.items[0]?.href).toBe(
      '/candidatures?campagne=CAMP-2026-991&statut=a_valider',
    );
  });

  it('les propositions mènent à la revue GROUPÉE, jamais à une liste', () => {
    expect(buildTodayBoard(input()).proposals.href).toBe(
      '/candidatures/validation',
    );
  });

  it('un entretien à pointer mène à Entretiens, section « à pointer »', () => {
    const board = buildTodayBoard(
      input({
        scheduled: [
          {
            briefId: 'b1',
            candidateName: 'Damois Bernard',
            campaignId: 'CAMP-2026-221',
            interviewStartAt: ilYA(1),
            section: 'a_pointer',
          },
        ],
      }),
    );
    expect(board.interviews.items[0]?.href).toBe(
      '/entretiens?campagne=CAMP-2026-221&section=a_pointer',
    );
  });

  it('un signal d’incohérence mène là où le problème se traite', () => {
    // Piège : ce signal porte une cible d'ONGLET, pas une route. Un repli
    // « vers les campagnes » l'enverrait là où le problème n'est pas.
    const board = buildTodayBoard(
      input({
        signals: [
          signal({
            key: 'validations_incoherentes',
            target: { tab: 'validations' },
          }),
        ],
      }),
    );
    expect(board.verify.items[0]?.href).toBe('/candidatures?statut=a_valider');
  });
});

describe('« À vérifier » ne parle jamais d’un candidat', () => {
  it('les signaux de dossier sont servis par les autres sections', () => {
    const board = buildTodayBoard(
      input({
        signals: [
          signal({ key: 'pending_validations_overdue' }),
          signal({ key: 'interviews_awaiting_decision' }),
          signal({ key: 'interviews_awaiting_pointing' }),
          signal({ key: 'availability_holidays_unblocked' }),
          signal({ key: 'campaign_without_candidates' }),
        ],
      }),
    );
    expect(board.verify.items.map((i) => i.key)).toEqual([
      'availability_holidays_unblocked',
      'campaign_without_candidates',
    ]);
  });
});

describe('sections unitaires plafonnées', () => {
  it('« à décider » montre au plus 5 lignes mais compte le total', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      validation({ id: `v${i}`, createdAt: ilYA(20 - i) }),
    );
    const zones = Object.fromEntries(many.map((v) => [v.id, 'gray' as const]));
    const board = buildTodayBoard(
      input({ validations: many, zoneByValidation: zones }),
    );
    expect(board.decide.items).toHaveLength(TODAY_SECTION_LIMIT);
    expect(board.decide.total).toBe(8);
  });

  it('le plus ancien d’abord — c’est l’attente qui fait la priorité', () => {
    const board = buildTodayBoard(
      input({
        validations: [
          validation({ id: 'recent', createdAt: ilYA(1), score: 95 }),
          validation({ id: 'vieux', createdAt: ilYA(30), score: 60 }),
        ],
        zoneByValidation: { recent: 'gray', vieux: 'gray' },
      }),
    );
    expect(board.decide.items.map((i) => i.id)).toEqual(['vieux', 'recent']);
    expect(board.decide.items[0]?.waitingDays).toBe(30);
  });

  it('pointer AVANT le verdict — un verdict se pose sur un entretien pointé', () => {
    const board = buildTodayBoard(
      input({
        verdict: [
          {
            briefId: 'v1',
            candidateName: 'Molika Khuon',
            campaignId: 'CAMP-2026-221',
            interviewStartAt: ilYA(3),
          },
        ],
        scheduled: [
          {
            briefId: 'p1',
            candidateName: 'Damois Bernard',
            campaignId: 'CAMP-2026-221',
            interviewStartAt: ilYA(1),
            section: 'a_pointer',
          },
        ],
      }),
    );
    expect(board.interviews.items.map((i) => i.kind)).toEqual([
      'a_pointer',
      'verdict',
    ]);
  });

  it('un entretien À VENIR n’attend rien de nous', () => {
    const board = buildTodayBoard(
      input({
        scheduled: [
          {
            briefId: 'x',
            candidateName: 'Demain',
            campaignId: 'CAMP-2026-221',
            interviewStartAt: new Date(NOW + 86_400_000).toISOString(),
            section: 'a_venir',
          },
        ],
      }),
    );
    expect(board.interviews.total).toBe(0);
    expect(board.allClear).toBe(true);
  });
});
