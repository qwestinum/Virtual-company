/**
 * Clôture de plus de 20 dossiers : file et rail (14/09/2026).
 *
 * La file est une entrée de journal ; le rail l'exécute tant qu'aucune entrée
 * de fin ne porte le même identifiant. Ces tests tiennent la lecture défensive
 * d'une entrée (elle vient de la base) et le calcul de ce qui reste à faire.
 */
import { describe, expect, it } from 'vitest';

import {
  DISMISSAL_CONCURRENCY,
  DISMISSAL_SYNC_MAX,
  parseQueuedBatch,
  pendingQueuedBatches,
} from '@/lib/candidatures/dismissal-batch';

const queued = (queueId: string, campaignId: string | null = 'CAMP-2026-100') => ({
  campaignId,
  payload: {
    queueId,
    total: 42,
    reason: 'campagne_cloturee',
    sendMail: true,
    dismissedByUser: { userId: 'u1', email: 'drh@cabinet.fr' },
    actor: 'user',
  },
});

describe('clôture — paramètres arbitrés', () => {
  it('concurrence 5, synchrone jusqu’à 20 dossiers', () => {
    expect(DISMISSAL_CONCURRENCY).toBe(5);
    expect(DISMISSAL_SYNC_MAX).toBe(20);
  });
});

describe('parseQueuedBatch', () => {
  it('restitue les options du lot telles que la clôture les a posées', () => {
    expect(parseQueuedBatch(queued('q1'))).toEqual({
      queueId: 'q1',
      campaignId: 'CAMP-2026-100',
      opts: {
        reason: 'campagne_cloturee',
        sendMail: true,
        dismissedByUser: { userId: 'u1', email: 'drh@cabinet.fr' },
        actor: 'user',
      },
    });
  });

  it('entrée illisible ⇒ ignorée (jamais un lot exécuté avec des options devinées)', () => {
    expect(parseQueuedBatch(queued('q1', null))).toBeNull();
    expect(parseQueuedBatch({ campaignId: 'C', payload: { queueId: 'q', reason: 'x' } })).toBeNull();
    expect(parseQueuedBatch({ campaignId: 'C', payload: { reason: 'x', sendMail: false } })).toBeNull();
  });

  it('sans identité d’utilisateur ⇒ décideur null', () => {
    const entry = queued('q2');
    entry.payload.dismissedByUser = null as never;
    expect(parseQueuedBatch(entry)?.opts.dismissedByUser).toBeNull();
  });
});

describe('pendingQueuedBatches', () => {
  it('un lot terminé (entrée de fin au même identifiant) sort de la file', () => {
    const pending = pendingQueuedBatches(
      [queued('q1'), queued('q2')],
      [{ payload: { queueId: 'q1', dismissed: 42 } }],
    );
    expect(pending.map((b) => b.queueId)).toEqual(['q2']);
  });

  it('une clôture synchrone (fin SANS identifiant) ne termine aucun lot', () => {
    const pending = pendingQueuedBatches([queued('q1')], [{ payload: { dismissed: 3 } }]);
    expect(pending.map((b) => b.queueId)).toEqual(['q1']);
  });

  it('garde l’ordre fourni (les plus anciens d’abord côté rail)', () => {
    const pending = pendingQueuedBatches([queued('a'), queued('b'), queued('c')], []);
    expect(pending.map((b) => b.queueId)).toEqual(['a', 'b', 'c']);
  });
});
