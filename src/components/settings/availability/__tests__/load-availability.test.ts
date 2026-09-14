/**
 * Le pré-chargement des disponibilités ne sert qu'une fois, et seulement pour
 * l'agenda qu'il a lu. Tout le reste relit le serveur, comme avant.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  availabilityEndpoint,
  fetchAvailability,
  usablePreload,
  type AvailabilityPayload,
  type PreloadedAvailability,
} from '../load-availability';

const PAYLOAD: AvailabilityPayload = { resource: null, rules: [], exceptions: [], preview: [] };

function preload(over: Partial<PreloadedAvailability> = {}): PreloadedAvailability {
  return { recruiterId: 'u1', promise: Promise.resolve(PAYLOAD), used: false, ...over };
}

describe('usablePreload', () => {
  it('rend la lecture en cours pour le même agenda', () => {
    const p = preload();
    expect(usablePreload(p, 'u1')).toBe(p.promise);
  });

  it('ignore un autre agenda', () => {
    expect(usablePreload(preload(), 'u2')).toBeNull();
  });

  it('ne resservit pas un chargement déjà appliqué', () => {
    expect(usablePreload(preload({ used: true }), 'u1')).toBeNull();
  });

  it('sans pré-chargement, on relit', () => {
    expect(usablePreload(null, 'u1')).toBeNull();
    expect(usablePreload(undefined, 'u1')).toBeNull();
  });
});

describe('fetchAvailability', () => {
  it('lit la route du recruteur, sans cache', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }));
    expect(await fetchAvailability('a b', fetcher as typeof fetch)).toEqual(PAYLOAD);
    expect(fetcher).toHaveBeenCalledWith(availabilityEndpoint('a b'), { cache: 'no-store' });
    expect(availabilityEndpoint('a b')).toBe('/api/recruiters/a%20b/availability');
  });

  it('une réponse en erreur ne s’applique pas', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 403 }));
    expect(await fetchAvailability('u1', fetcher as typeof fetch)).toBeNull();
  });

  it('réseau KO ou corps illisible : null, jamais une exception', async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchAvailability('u1', down as typeof fetch)).toBeNull();
    const garbled = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await fetchAvailability('u1', garbled as typeof fetch)).toBeNull();
  });
});
