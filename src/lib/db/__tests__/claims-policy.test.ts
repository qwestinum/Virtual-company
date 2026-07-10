/**
 * Politique des réservations d'effets de bord (audit C5/C6/I7) — PURE.
 *
 * La règle testée : un claim en conflit rend un verdict PRÉCIS —
 * `already_confirmed` (effet prouvé, ne jamais refaire), `in_flight` (jeune
 * non confirmé, différer), `stale` (périmé non confirmé = orphelin de crash,
 * reprenable). C'est ce qui remplace le « duplicate » menteur sur claim
 * orphelin (candidat muet) et rend le retry humain sûr.
 */
import { describe, expect, it } from 'vitest';

import {
  CLAIM_TTL_MINUTES,
  CLAIM_TTL_MS,
  isStaleTimestamp,
  resolveClaimConflict,
} from '@/lib/db/claims-policy';

const NOW = new Date('2026-07-10T10:00:00.000Z');
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60_000).toISOString();

describe('resolveClaimConflict', () => {
  it('claim CONFIRMÉ → already_confirmed, quel que soit son âge', () => {
    expect(
      resolveClaimConflict(
        { confirmedAt: minutesAgo(120), createdAt: minutesAgo(125) },
        NOW,
      ),
    ).toBe('already_confirmed');
    expect(
      resolveClaimConflict(
        { confirmedAt: minutesAgo(0), createdAt: minutesAgo(0) },
        NOW,
      ),
    ).toBe('already_confirmed');
  });

  it('claim jeune NON confirmé → in_flight (un envoi est peut-être en cours)', () => {
    expect(
      resolveClaimConflict(
        { confirmedAt: null, createdAt: minutesAgo(1) },
        NOW,
      ),
    ).toBe('in_flight');
    // Juste sous le TTL : encore in_flight.
    expect(
      resolveClaimConflict(
        { confirmedAt: null, createdAt: minutesAgo(CLAIM_TTL_MINUTES - 1) },
        NOW,
      ),
    ).toBe('in_flight');
  });

  it('claim PÉRIMÉ non confirmé → stale (orphelin de crash, reprenable)', () => {
    expect(
      resolveClaimConflict(
        { confirmedAt: null, createdAt: minutesAgo(CLAIM_TTL_MINUTES + 1) },
        NOW,
      ),
    ).toBe('stale');
  });

  it('createdAt absent/illisible → stale (récupérable, jamais un piège)', () => {
    expect(
      resolveClaimConflict({ confirmedAt: null, createdAt: null }, NOW),
    ).toBe('stale');
    expect(
      resolveClaimConflict(
        { confirmedAt: null, createdAt: 'pas-une-date' },
        NOW,
      ),
    ).toBe('stale');
  });
});

describe('isStaleTimestamp', () => {
  it('frontière exacte : plus vieux que le TTL = périmé, pile au TTL = encore valide', () => {
    const atTtl = new Date(NOW.getTime() - CLAIM_TTL_MS).toISOString();
    expect(isStaleTimestamp(atTtl, NOW)).toBe(false); // strictement <
    const justOver = new Date(NOW.getTime() - CLAIM_TTL_MS - 1).toISOString();
    expect(isStaleTimestamp(justOver, NOW)).toBe(true);
  });

  it('null / illisible → périmé (fail-safe récupérable)', () => {
    expect(isStaleTimestamp(null, NOW)).toBe(true);
    expect(isStaleTimestamp('n/a', NOW)).toBe(true);
  });
});
