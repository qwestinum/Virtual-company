import { describe, expect, it } from 'vitest';

import { combineZoneCounts } from '@/lib/dashboard/zone-counts';

describe('combineZoneCounts', () => {
  it('partitionne correctement (cas typique)', () => {
    const z = combineZoneCounts({
      acceptedTotal: 10,
      rejectedTotal: 20,
      humanAccepted: 2,
      humanRejected: 3,
      pending: 7, // gris en attente (status rejected provisoire)
    });
    expect(z).toEqual({
      autoAccept: 8, // 10 - 2 (acceptés humains)
      autoReject: 10, // 20 - 3 (refus humains) - 7 (en attente)
      humanValidated: 5, // 2 + 3
      pending: 7,
      total: 30,
    });
  });

  it('la somme des 4 zones = total (invariant)', () => {
    const z = combineZoneCounts({
      acceptedTotal: 14,
      rejectedTotal: 33,
      humanAccepted: 5,
      humanRejected: 4,
      pending: 9,
    });
    expect(z.autoAccept + z.autoReject + z.humanValidated + z.pending).toBe(z.total);
  });

  it('en attente non nul (bug corrigé : ne vaut plus 0 par décompte gris)', () => {
    const z = combineZoneCounts({
      acceptedTotal: 0,
      rejectedTotal: 7,
      humanAccepted: 0,
      humanRejected: 0,
      pending: 7,
    });
    expect(z.pending).toBe(7);
    expect(z.autoReject).toBe(0); // 7 rejected sont tous en attente → 0 refus auto
  });

  it('clamp à 0 (jamais de négatif)', () => {
    const z = combineZoneCounts({
      acceptedTotal: 1,
      rejectedTotal: 5,
      humanAccepted: 0,
      humanRejected: 3,
      pending: 7, // > rejected restants → clamp
    });
    expect(z.autoReject).toBe(0);
  });

  it('tout à zéro → propre', () => {
    const z = combineZoneCounts({
      acceptedTotal: 0,
      rejectedTotal: 0,
      humanAccepted: 0,
      humanRejected: 0,
      pending: 0,
    });
    expect(z).toEqual({
      autoAccept: 0,
      autoReject: 0,
      humanValidated: 0,
      pending: 0,
      total: 0,
    });
  });
});
