import { describe, expect, it } from 'vitest';

import { hiredUidsSince } from '@/lib/vivier/hired-exclusion';

const m = (uid: string, status: string, createdAt: string) => ({
  action: 'candidate_hired_marked',
  payload: { uid, status },
  createdAt,
});

describe('vivier — un recruté n’est plus proposé pendant la durée réglée', () => {
  const SINCE = '2025-09-28T00:00:00.000Z';

  it('désigné dans la fenêtre ⇒ exclu', () => {
    expect(hiredUidsSince([m('u1', 'hired', '2026-09-01T10:00:00Z')], SINCE)).toEqual(['u1']);
  });

  it('désigné AVANT la fenêtre ⇒ de nouveau proposable', () => {
    expect(hiredUidsSince([m('u1', 'hired', '2025-01-01T10:00:00Z')], SINCE)).toEqual([]);
  });

  it('désignation annulée (gomme) ⇒ jamais exclu', () => {
    expect(
      hiredUidsSince(
        [m('u1', 'hired', '2026-09-01T10:00:00Z'), m('u1', 'cleared', '2026-09-02T10:00:00Z')],
        SINCE,
      ),
    ).toEqual([]);
  });

  it('ordre d’itération libre : un marqueur plus ancien ne reprend pas la main', () => {
    expect(
      hiredUidsSince(
        [m('u1', 'cleared', '2026-09-02T10:00:00Z'), m('u1', 'hired', '2026-09-01T10:00:00Z')],
        SINCE,
      ),
    ).toEqual([]);
  });

  it('les autres actions et les payloads illisibles sont ignorés', () => {
    expect(
      hiredUidsSince(
        [
          { action: 'candidate_validation_marked', payload: { uid: 'u2', status: 'validated' }, createdAt: '2026-09-01' },
          { action: 'candidate_hired_marked', payload: { status: 'hired' }, createdAt: '2026-09-01' },
        ],
        SINCE,
      ),
    ).toEqual([]);
  });
});
