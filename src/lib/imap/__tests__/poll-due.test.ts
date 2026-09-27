import { describe, expect, it } from 'vitest';

import { isMailboxDue, MAILBOX_POLL_INTERVAL_MS, nextReadAt } from '@/lib/imap/poll-due';

const T = Date.parse('2026-09-26T10:00:00.000Z');
const ago = (ms: number) => new Date(T - ms).toISOString();

describe('échéance de relève d’une boîte', () => {
  it('jamais relevée ou relevée depuis l’intervalle : due ; sinon non', () => {
    expect(isMailboxDue(null, T)).toBe(true);
    expect(isMailboxDue(ago(MAILBOX_POLL_INTERVAL_MS), T)).toBe(true);
    expect(isMailboxDue(ago(MAILBOX_POLL_INTERVAL_MS - 1), T)).toBe(false);
    expect(isMailboxDue('pas une date', T)).toBe(true);
  });

  it('l’intervalle est sous la cadence du cron (60 s) : la gigue ne fait pas sauter un passage sur deux', () => {
    expect(MAILBOX_POLL_INTERVAL_MS).toBeLessThan(60_000);
    // Cron relancé 59,6 s après le précédent : la boîte est due.
    expect(isMailboxDue(ago(59_600), T)).toBe(true);
  });

  it('prochaine lecture = première échéance, bornée à l’intervalle', () => {
    const boxes = [
      { id: 'a', lastPolledAt: ago(10_000) }, // due dans 40 s
      { id: 'b', lastPolledAt: ago(30_000) }, // due dans 20 s
    ];
    expect(nextReadAt(boxes, new Set(), T)).toBe(T + 20_000);
    // Relevée à l'instant : elle repart pour un intervalle entier.
    expect(nextReadAt(boxes, new Set(['b']), T)).toBe(T + 40_000);
    // Déjà en retard : on relit tout de suite, jamais dans le passé.
    expect(nextReadAt([{ id: 'c', lastPolledAt: ago(10 * 60_000) }], new Set(), T)).toBe(T);
    // Aucune boîte : on relit à l'intervalle pour découvrir une boîte activée entre-temps.
    expect(nextReadAt([], new Set(), T)).toBe(T + MAILBOX_POLL_INTERVAL_MS);
  });
});
