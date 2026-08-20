/**
 * Lignes des onglets Entretiens — PUR.
 *
 * Deux règles portent tout : ne montrer que des candidatures encore OUVERTES
 * (sinon la page propose de pointer un entretien déjà tranché ailleurs), et
 * une candidature = une ligne.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAwaitingRows,
  buildScheduledRows,
  daysBetween,
  type BriefFacts,
} from '@/lib/interviews/pipeline-rows';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

function brief(over: Partial<BriefFacts> & { briefId: string }): BriefFacts {
  return {
    uid: 'u1',
    campaignId: 'CAMP-1',
    candidateName: 'Alice Martin',
    candidateEmail: 'alice@mail.com',
    jobTitle: 'Comptable',
    updatedAt: '2026-09-14T12:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    interviewStartAt: null,
    interviewEndAt: null,
    interviewLocation: null,
    bookingUid: null,
    ...over,
  };
}

const openStage = () => 'invite';

describe('en attente de réservation', () => {
  it('compte l’ancienneté depuis la REMISE en attente, pas depuis l’origine', () => {
    // Un briefing rouvert après une annulation naîtrait sinon « en retard de
    // deux semaines » — un badge qui crie faux ne se lit plus.
    const { rows: [row] } = buildAwaitingRows(
      [brief({ briefId: 'b1', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-14T12:00:00.000Z' })],
      {
        nowMs: NOW,
        thresholdDays: 5,
        stageOf: openStage,
        analysisIdOf: () => 'can_1',
        linkStatusOf: () => 'active',
      },
    );
    expect(row!.waitingDays).toBe(1);
    expect(row!.overdue).toBe(false);
  });

  it('badge au-delà du seuil, le plus ancien en tête', () => {
    const { rows } = buildAwaitingRows(
      [
        brief({ briefId: 'jeune', uid: 'u1', updatedAt: '2026-09-14T12:00:00.000Z' }),
        brief({ briefId: 'vieux', uid: 'u2', updatedAt: '2026-09-01T12:00:00.000Z' }),
      ],
      {
        nowMs: NOW,
        thresholdDays: 5,
        stageOf: openStage,
        analysisIdOf: (uid) => `can_${uid}`,
        linkStatusOf: () => 'active',
      },
    );
    expect(rows.map((r) => r.briefId)).toEqual(['vieux', 'jeune']);
    expect(rows[0]!.overdue).toBe(true);
    expect(rows[1]!.overdue).toBe(false);
  });

  it('régime Cal.com : aucun état de lien, et ce n’est pas une anomalie', () => {
    const { rows: [row] } = buildAwaitingRows([brief({ briefId: 'b1' })], {
      nowMs: NOW,
      thresholdDays: 5,
      stageOf: openStage,
      analysisIdOf: () => 'can_1',
      linkStatusOf: () => null,
    });
    expect(row!.linkStatus).toBeNull();
  });

  it('EXCLUT une candidature déjà tranchée ailleurs', () => {
    // Marquée « absent » depuis le menu Candidatures : le briefing reste en
    // base, mais proposer de la relancer ici serait rouvrir un dossier clos.
    const { rows } = buildAwaitingRows([brief({ briefId: 'b1' })], {
      nowMs: NOW,
      thresholdDays: 5,
      stageOf: () => 'non_retenu',
      analysisIdOf: () => 'can_1',
      linkStatusOf: () => null,
    });
    expect(rows).toEqual([]);
  });

  it('EXCLUT un uid dont l’analyse est introuvable — on ne devine pas', () => {
    const { rows } = buildAwaitingRows([brief({ briefId: 'b1' })], {
      nowMs: NOW,
      thresholdDays: 5,
      stageOf: () => null,
      analysisIdOf: () => null,
      linkStatusOf: () => null,
    });
    expect(rows).toEqual([]);
  });

  it('deux briefings pour un même uid ⇒ une ligne, la plus récente', () => {
    const { rows } = buildAwaitingRows(
      [
        brief({ briefId: 'ancien', updatedAt: '2026-09-10T12:00:00.000Z' }),
        brief({ briefId: 'recent', updatedAt: '2026-09-14T12:00:00.000Z' }),
      ],
      {
        nowMs: NOW,
        thresholdDays: 5,
        stageOf: openStage,
        analysisIdOf: () => 'can_1',
        linkStatusOf: () => 'active',
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.briefId).toBe('recent');
  });
});

describe('programmés', () => {
  const ctx = (stageOf: (uid: string) => string | null) => ({
    nowMs: NOW,
    pointingAgeHours: 24,
    stageOf,
    analysisIdOf: () => 'can_1',
  });

  it('entretien terminé il y a plus de N heures ⇒ à pointer', () => {
    const { rows: [row] } = buildScheduledRows(
      [
        brief({
          briefId: 'b1',
          interviewStartAt: '2026-09-13T09:00:00.000Z',
          interviewEndAt: '2026-09-13T10:00:00.000Z',
        }),
      ],
      ctx(openStage),
    );
    expect(row!.section).toBe('a_pointer');
  });

  it('entretien terminé il y a MOINS de N heures : on laisse le temps de pointer', () => {
    const { rows: [row] } = buildScheduledRows(
      [
        brief({
          briefId: 'b1',
          interviewStartAt: '2026-09-15T09:00:00.000Z',
          interviewEndAt: '2026-09-15T10:00:00.000Z',
        }),
      ],
      ctx(openStage),
    );
    expect(row!.section).toBe('a_venir');
  });

  it('sans date de fin, jamais « passé » — on ne date pas ce qu’on ignore', () => {
    const { rows: [row] } = buildScheduledRows(
      [brief({ briefId: 'b1', interviewStartAt: '2026-09-01T09:00:00.000Z' })],
      ctx(openStage),
    );
    expect(row!.section).toBe('a_venir');
  });

  it('entretien POINTÉ réalisé ⇒ attente de verdict, plus de pointage à demander', () => {
    const { rows: [row] } = buildScheduledRows(
      [
        brief({
          briefId: 'b1',
          interviewStartAt: '2026-09-13T09:00:00.000Z',
          interviewEndAt: '2026-09-13T10:00:00.000Z',
        }),
      ],
      ctx(() => 'entretien_fait'),
    );
    expect(row!.section).toBe('verdict_attendu');
  });

  it('décision prise ⇒ la ligne disparaît (extinction par construction)', () => {
    const { rows } = buildScheduledRows(
      [
        brief({
          briefId: 'b1',
          interviewEndAt: '2026-09-13T10:00:00.000Z',
        }),
      ],
      ctx(() => 'retenu'),
    );
    expect(rows).toEqual([]);
  });

  it('ce qui demande une action passe devant le chronologique', () => {
    const { rows } = buildScheduledRows(
      [
        brief({
          briefId: 'demain',
          uid: 'u1',
          interviewStartAt: '2026-09-16T09:00:00.000Z',
          interviewEndAt: '2026-09-16T10:00:00.000Z',
        }),
        brief({
          briefId: 'hier',
          uid: 'u2',
          interviewStartAt: '2026-09-13T09:00:00.000Z',
          interviewEndAt: '2026-09-13T10:00:00.000Z',
        }),
      ],
      ctx(openStage),
    );
    expect(rows.map((r) => r.briefId)).toEqual(['hier', 'demain']);
  });
});

describe('daysBetween', () => {
  it('plancher à zéro : une date future ne donne pas un négatif', () => {
    expect(daysBetween('2026-09-20T12:00:00.000Z', NOW)).toBe(0);
    expect(daysBetween('2026-09-10T12:00:00.000Z', NOW)).toBe(5);
  });
});

describe('le compteur compte ce qui est AFFICHÉ', () => {
  it('signale les briefings écartés faute de candidature retrouvable', () => {
    // Défaut constaté à l'usage : l'onglet annonçait 5 (compte brut de la
    // table) là où la liste montrait 3. Un compteur qui ne compte pas ce
    // qu'on voit détruit la confiance dans les deux — et faisait disparaître
    // sans un mot les briefings dont la candidature est introuvable.
    const stages: Record<string, string | null> = {
      ouvert1: 'invite',
      ouvert2: 'rdv_pris',
      ferme: 'non_retenu',
      inconnu1: null,
      inconnu2: null,
    };
    const built = buildAwaitingRows(
      Object.keys(stages).map((uid) => brief({ briefId: uid, uid })),
      {
        nowMs: NOW,
        thresholdDays: 5,
        stageOf: (uid) => stages[uid] ?? null,
        analysisIdOf: () => 'can_1',
        linkStatusOf: () => null,
      },
    );

    expect(built.rows).toHaveLength(2);
    // Une candidature CLOSE n'est pas une anomalie : elle a été tranchée
    // ailleurs, c'est le fonctionnement normal. Seul l'introuvable l'est.
    expect(built.unresolved).toBe(2);
  });

  it('rien d’anormal ⇒ aucun écart à signaler', () => {
    const built = buildScheduledRows([brief({ briefId: 'b1' })], {
      nowMs: NOW,
      pointingAgeHours: 24,
      stageOf: () => 'rdv_pris',
      analysisIdOf: () => 'can_1',
    });
    expect(built.rows).toHaveLength(1);
    expect(built.unresolved).toBe(0);
  });
});
