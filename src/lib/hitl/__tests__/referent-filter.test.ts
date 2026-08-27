/**
 * Filtre « Référent » de la file des validations suspendues.
 *
 * Ce qui est vérifié ici tient en une phrase : le filtre RÉDUIT ce qui
 * s'affiche, il ne change JAMAIS ce qui existe. Les comptes restent
 * exhaustifs, « Tous » restaure l'intégralité, et aucune catégorie ne se
 * retrouve sans porte d'entrée.
 */

import { describe, expect, it } from 'vitest';

import {
  activeReferentOf,
  ALL_REFERENTS,
  buildReferentOptions,
  filterByReferent,
  initialsOf,
  myCampaignsCount,
  referentSelectionKey,
  shortRecruiterName,
  type ReferentByCampaign,
} from '@/lib/hitl/referent-filter';

const SARAH = { id: 'u-sarah', displayName: 'Sarah Dupont', isActive: true };
const MARC = { id: 'u-marc', displayName: 'Marc Lefèvre', isActive: true };
/** Recruteur DÉSACTIVÉ (cas transitoire : sorti de l'espace). */
const YANN = { id: 'u-yann', displayName: 'Yann Bernard', isActive: false };

const REFERENTS: ReferentByCampaign = {
  'CAMP-2026-001': SARAH,
  'CAMP-2026-002': MARC,
  'CAMP-2026-003': YANN,
  // Campagne SANS référent (jamais désigné).
  'CAMP-2026-004': null,
};

const v = (id: string, campaignId: string) => ({ id, campaignId });

const FILE = [
  v('val-1', 'CAMP-2026-001'),
  v('val-2', 'CAMP-2026-001'),
  v('val-3', 'CAMP-2026-002'),
  v('val-4', 'CAMP-2026-003'), // référent désactivé
  v('val-5', 'CAMP-2026-004'), // aucun référent
  v('val-6', 'CAMP-2026-999'), // campagne inconnue de la Map
];

describe('activeReferentOf', () => {
  it('rend le référent quand il est actif', () => {
    expect(activeReferentOf('CAMP-2026-001', REFERENTS)).toEqual(SARAH);
  });

  it('rend null pour un référent DÉSACTIVÉ, une campagne sans référent, ou inconnue', () => {
    expect(activeReferentOf('CAMP-2026-003', REFERENTS)).toBeNull();
    expect(activeReferentOf('CAMP-2026-004', REFERENTS)).toBeNull();
    expect(activeReferentOf('CAMP-2026-999', REFERENTS)).toBeNull();
  });
});

describe('filterByReferent', () => {
  it('ne garde que les validations des campagnes du référent choisi', () => {
    const shown = filterByReferent(FILE, REFERENTS, {
      kind: 'recruiter',
      id: SARAH.id,
    });
    expect(shown.map((x) => x.id)).toEqual(['val-1', 'val-2']);
  });

  it('« Tous » restaure l’intégralité de la file', () => {
    const shown = filterByReferent(FILE, REFERENTS, ALL_REFERENTS);
    expect(shown.map((x) => x.id)).toEqual(FILE.map((x) => x.id));
  });

  it('« Référent non défini » réunit désactivé, sans référent et campagne inconnue', () => {
    const shown = filterByReferent(FILE, REFERENTS, { kind: 'none' });
    expect(shown.map((x) => x.id)).toEqual(['val-4', 'val-5', 'val-6']);
  });

  it('ne mute jamais la liste source', () => {
    const before = [...FILE];
    filterByReferent(FILE, REFERENTS, { kind: 'recruiter', id: MARC.id });
    expect(FILE).toEqual(before);
  });

  it('la partition filtrée est exhaustive : la somme des entrées = la file', () => {
    const options = buildReferentOptions(FILE, REFERENTS);
    const sum = options
      .filter((o) => o.selection.kind !== 'all')
      .reduce((acc, o) => acc + o.count, 0);
    expect(sum).toBe(FILE.length);
  });
});

describe('buildReferentOptions', () => {
  it('compte chaque référent ACTIF ayant au moins un dossier, tri décroissant', () => {
    const options = buildReferentOptions(FILE, REFERENTS);
    expect(options.map((o) => [o.label, o.count])).toEqual([
      ['Tous', 6],
      ['Sarah D.', 2],
      ['Marc L.', 1],
      ['Référent non défini', 3],
    ]);
  });

  it('n’expose JAMAIS un recruteur désactivé comme entrée de filtre', () => {
    const labels = buildReferentOptions(FILE, REFERENTS).map((o) => o.label);
    expect(labels).not.toContain('Yann B.');
  });

  it('un référent désactivé reste JOIGNABLE via « Référent non défini »', () => {
    const none = buildReferentOptions(FILE, REFERENTS).find(
      (o) => o.selection.kind === 'none',
    );
    expect(none?.count).toBe(3);
    const shown = filterByReferent(FILE, REFERENTS, { kind: 'none' });
    expect(shown.map((x) => x.id)).toContain('val-4');
  });

  it('omet « Référent non défini » quand la catégorie est vide', () => {
    const items = [v('a', 'CAMP-2026-001'), v('b', 'CAMP-2026-002')];
    const kinds = buildReferentOptions(items, REFERENTS).map(
      (o) => o.selection.kind,
    );
    expect(kinds).toEqual(['all', 'recruiter', 'recruiter']);
  });

  it('file vide → une seule entrée « Tous (0) » (la barre se retire)', () => {
    expect(buildReferentOptions([], REFERENTS)).toEqual([
      { selection: ALL_REFERENTS, label: 'Tous', count: 0 },
    ]);
  });
});

describe('myCampaignsCount', () => {
  it('compte les dossiers dont le référent est le lecteur', () => {
    expect(myCampaignsCount(FILE, REFERENTS, SARAH.id)).toBe(2);
  });

  it('rend 0 sans session résolue — le raccourci se retire', () => {
    expect(myCampaignsCount(FILE, REFERENTS, null)).toBe(0);
  });

  it('rend 0 pour un recruteur DÉSACTIVÉ (il n’est plus référent actif)', () => {
    expect(myCampaignsCount(FILE, REFERENTS, YANN.id)).toBe(0);
  });
});

describe('libellés', () => {
  it('abrège le nom de famille', () => {
    expect(shortRecruiterName('Sarah Dupont')).toBe('Sarah D.');
    expect(shortRecruiterName('  Marc   Lefèvre ')).toBe('Marc L.');
    expect(shortRecruiterName('Jean Pierre Martin')).toBe('Jean Pierre M.');
  });

  it('laisse un mono-mot intact', () => {
    expect(shortRecruiterName('Sarah')).toBe('Sarah');
  });

  it('rend des initiales non vides', () => {
    expect(initialsOf('Sarah Dupont')).toBe('SD');
    expect(initialsOf('Sarah')).toBe('SA');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('referentSelectionKey', () => {
  it('distingue chaque sélection — clé stable, jamais un identifiant nu', () => {
    expect(referentSelectionKey(ALL_REFERENTS)).toBe('all');
    expect(referentSelectionKey({ kind: 'none' })).toBe('none');
    expect(referentSelectionKey({ kind: 'recruiter', id: 'u-1' })).toBe(
      'recruiter:u-1',
    );
  });
});
