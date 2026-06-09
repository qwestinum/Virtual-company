import { describe, expect, it } from 'vitest';

import { donneurOrdreRowToDomain } from '@/lib/db/repos/donneurs-ordre';
import { siteRowToDomain } from '@/lib/db/repos/sites';
import type { DonneurOrdreRow, SiteRow } from '@/lib/db/types';

describe('siteRowToDomain', () => {
  it('mappe une row site en domaine (snake_case → camelCase)', () => {
    const row: SiteRow = {
      id: 'SITE-1',
      name: 'Clinique de Bordeaux',
      type: 'Établissement médical',
      city: 'Bordeaux',
      postal_code: '33000',
      archived_at: null,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };
    expect(siteRowToDomain(row)).toEqual({
      id: 'SITE-1',
      name: 'Clinique de Bordeaux',
      type: 'Établissement médical',
      city: 'Bordeaux',
      postalCode: '33000',
      archivedAt: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    });
  });

  it('préserve les nullables et archived_at', () => {
    const row: SiteRow = {
      id: 'SITE-2',
      name: 'X',
      type: null,
      city: null,
      postal_code: null,
      archived_at: '2026-06-02T00:00:00Z',
      created_at: 'a',
      updated_at: 'b',
    };
    const d = siteRowToDomain(row);
    expect(d.type).toBeNull();
    expect(d.postalCode).toBeNull();
    expect(d.archivedAt).toBe('2026-06-02T00:00:00Z');
  });
});

describe('donneurOrdreRowToDomain', () => {
  it('mappe une row donneur d’ordre en domaine', () => {
    const row: DonneurOrdreRow = {
      id: 'DO-1',
      first_name: 'Marie',
      last_name: 'Durand',
      email: 'marie@exemple.fr',
      role: 'DRH adjoint',
      archived_at: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(donneurOrdreRowToDomain(row)).toEqual({
      id: 'DO-1',
      firstName: 'Marie',
      lastName: 'Durand',
      email: 'marie@exemple.fr',
      role: 'DRH adjoint',
      archivedAt: null,
      createdAt: 'a',
      updatedAt: 'b',
    });
  });

  it('préserve les nullables (prénom / email / rôle)', () => {
    const row: DonneurOrdreRow = {
      id: 'DO-2',
      first_name: null,
      last_name: 'Nom',
      email: null,
      role: null,
      archived_at: null,
      created_at: 'a',
      updated_at: 'b',
    };
    const d = donneurOrdreRowToDomain(row);
    expect(d.firstName).toBeNull();
    expect(d.email).toBeNull();
    expect(d.role).toBeNull();
    expect(d.lastName).toBe('Nom');
  });
});
