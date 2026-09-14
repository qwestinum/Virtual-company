/**
 * Lecture partagée du journal : l'union des actions et la reprise, par chaque
 * dérivation, de SES seules actions — dans l'ordre reçu.
 */
import { describe, expect, it } from 'vitest';

import type { JournalEntry } from '@/lib/db/repos/journal';

import { pickActions, unionActions } from '../journal-preload';

function entry(id: number, action: string, createdAt: string): JournalEntry {
  return { id, action, campaignId: 'CAMP-1', actor: 'user', payload: { uid: 'u' }, createdAt };
}

describe('unionActions', () => {
  it('fusionne sans doublon, dans l’ordre de première apparition', () => {
    expect(unionActions(['a', 'b'], ['b', 'c'], ['a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('listes vides', () => {
    expect(unionActions()).toEqual([]);
    expect(unionActions([], [])).toEqual([]);
  });
});

describe('pickActions', () => {
  const rows = [
    entry(3, 'b', '2026-09-03T00:00:00.000Z'),
    entry(2, 'x', '2026-09-02T00:00:00.000Z'),
    entry(1, 'a', '2026-09-01T00:00:00.000Z'),
  ];

  it('ne garde que les actions demandées, sans réordonner', () => {
    expect(pickActions(rows, ['a', 'b']).map((e) => e.id)).toEqual([3, 1]);
  });

  it('rend exactement ce qu’une lecture ciblée aurait rendu', () => {
    // Une lecture `.in('action', ['a'])` triée DESC ⇔ l'union filtrée.
    const targeted = rows.filter((e) => e.action === 'a');
    expect(pickActions(rows, ['a'])).toEqual(targeted);
  });

  it('aucune action demandée ⇒ rien', () => {
    expect(pickActions(rows, [])).toEqual([]);
  });
});
