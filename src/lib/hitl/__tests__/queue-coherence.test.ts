/**
 * Le prédicat qui DÉSARME une carte d'arbitrage.
 *
 * Deux exigences opposées, et c'est tout l'intérêt de le tester :
 *   · il doit voir le cas de production (analyse `auto_accept`, fiche ouverte
 *     portant la direction `reject` avec un score de 100) — sans quoi un refus
 *     part à quelqu'un que le produit compte comme accepté ;
 *   · il ne doit JAMAIS conclure sur un doute : analyse introuvable ou zone
 *     absente, la carte garde son chemin de décision. Retirer un arbitrage sur
 *     une incertitude serait pire que la divergence qu'on cherche à voir.
 */
import { describe, expect, it } from 'vitest';

import {
  checkValidationCoherence,
  isSettledElsewhere,
  SETTLED_LABELS,
  type AnalysisFacts,
} from '@/lib/hitl/queue-coherence';

const facts = (over: Partial<NonNullable<AnalysisFacts>> = {}): AnalysisFacts => ({
  decisionZone: 'gray',
  decidedBy: 'auto',
  dismissedAt: null,
  ...over,
});

describe('ce qui attend vraiment — la carte garde son arbitrage', () => {
  it('les deux zones d’attente, décidées par personne', () => {
    expect(checkValidationCoherence(facts({ decisionZone: 'gray' }))).toEqual({
      kind: 'awaiting',
    });
    expect(
      checkValidationCoherence(facts({ decisionZone: 'proposed_reject' })),
    ).toEqual({ kind: 'awaiting' });
  });
});

describe('ce qui n’attend plus — la carte est désarmée', () => {
  it('LE CAS DE PRODUCTION : analyse acceptée, fiche encore ouverte', () => {
    // Kevin NGUYEN / Asma Zghonda, 21/08 : le re-scoring les a fait passer en
    // `auto_accept` sans fermer leur fiche, restée en direction `reject`.
    expect(checkValidationCoherence(facts({ decisionZone: 'auto_accept' }))).toEqual({
      kind: 'settled',
      reason: 'accepted',
    });
  });

  it('un humain a déjà tranché, depuis un autre écran', () => {
    // La zone reste `gray` (elle est figée au scoring) : seule `decidedBy` le
    // dit. Sans ce test, la correction de décision laisserait la carte armée.
    expect(
      checkValidationCoherence(facts({ decisionZone: 'gray', decidedBy: 'user' })),
    ).toEqual({ kind: 'settled', reason: 'decided' });
  });

  it('la candidature est classée sans suite — cela domine tout', () => {
    expect(
      checkValidationCoherence(
        facts({ decisionZone: 'proposed_reject', dismissedAt: '2026-09-01T00:00:00.000Z' }),
      ),
    ).toEqual({ kind: 'settled', reason: 'dismissed' });
  });

  it('zone `auto_reject` : une fiche portant l’ancien régime est une anomalie', () => {
    expect(checkValidationCoherence(facts({ decisionZone: 'auto_reject' }))).toEqual({
      kind: 'settled',
      reason: 'legacy_auto_reject',
    });
  });
});

describe('le doute ne conclut JAMAIS', () => {
  it('aucune analyse rapprochée', () => {
    expect(checkValidationCoherence(null)).toEqual({ kind: 'unknown' });
  });

  it('zone absente (ligne antérieure au modèle 3 zones)', () => {
    expect(checkValidationCoherence(facts({ decisionZone: null }))).toEqual({
      kind: 'unknown',
    });
  });

  it('une zone absente MAIS une décision humaine reste une clôture', () => {
    // L'ordre compte : la décision prime la zone, comme dans deriveCandidateStage.
    expect(
      checkValidationCoherence(facts({ decisionZone: null, decidedBy: 'user' })),
    ).toEqual({ kind: 'settled', reason: 'decided' });
  });

  it('`unknown` n’est jamais traité comme clos', () => {
    expect(isSettledElsewhere({ kind: 'unknown' })).toBe(false);
    expect(isSettledElsewhere({ kind: 'awaiting' })).toBe(false);
    expect(isSettledElsewhere({ kind: 'settled', reason: 'accepted' })).toBe(true);
  });
});

describe('ce que la carte dit', () => {
  it('chaque motif a une phrase, et aucune ne propose l’acte de refuser', () => {
    for (const [reason, label] of Object.entries(SETTLED_LABELS)) {
      expect(label.length).toBeGreaterThan(20);
      // Clore n'est pas refuser. C'est le VERBE qui est interdit, pas le nom :
      // `legacy_auto_reject` doit pouvoir nommer l'ancien régime de refus
      // automatique — le décrire est justement ce qu'on attend de lui.
      expect(label.toLowerCase(), `motif ${reason}`).not.toContain('refuser');
    }
  });
});
