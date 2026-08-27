/**
 * Qui est le recruteur d'une ligne de l'onglet « Entretiens ».
 *
 * Le cas qui justifie tout ce module : un rendez-vous est pris chez Sami, puis
 * la campagne change de référent pour Jane. Le rendez-vous, lui, ne bouge
 * PAS — la ressource est figée à la confirmation. Afficher Jane sur ce créneau
 * enverrait quelqu'un au mauvais entretien.
 */

import { describe, expect, it } from 'vitest';

import {
  buildReferentOptionsBy,
  filterByReferentBy,
  myReferentCountBy,
  type ReferentInfo,
} from '@/lib/referent/filter';
import {
  organizerEmailsByBooking,
  resolveRowReferent,
  type RowReferent,
} from '@/lib/interviews/referent-resolution';

const SAMI: ReferentInfo = { id: 'u-sami', displayName: 'Sami Belkacem', isActive: true };
const JANE: ReferentInfo = { id: 'u-jane', displayName: 'Jane Rossi', isActive: true };
const PARTI: ReferentInfo = { id: 'u-yann', displayName: 'Yann Bernard', isActive: false };

describe('resolveRowReferent', () => {
  it('titulaire inconnu (ligne en attente) → référent de la campagne, sans divergence', () => {
    expect(resolveRowReferent(JANE, null)).toEqual({
      referent: JANE,
      supersededBy: null,
    });
  });

  it('titulaire = référent actuel → une seule mention', () => {
    expect(resolveRowReferent(SAMI, SAMI)).toEqual({
      referent: SAMI,
      supersededBy: null,
    });
  });

  it('RDV tenu par Sami, campagne repassée à Jane → Sami affiché, Jane signalée', () => {
    const resolved = resolveRowReferent(JANE, SAMI);
    expect(resolved.referent).toEqual(SAMI);
    expect(resolved.supersededBy).toEqual(JANE);
  });

  it('titulaire connu sans référent de campagne → titulaire seul, aucune divergence inventée', () => {
    expect(resolveRowReferent(null, SAMI)).toEqual({
      referent: SAMI,
      supersededBy: null,
    });
  });

  it('ni titulaire ni référent → rien, et l’affichage dira « référent non défini »', () => {
    expect(resolveRowReferent(null, null)).toEqual({
      referent: null,
      supersededBy: null,
    });
  });
});

describe('le filtre suit ce qui est AFFICHÉ', () => {
  const row = (id: string, resolved: RowReferent) => ({ id, ...resolved });
  const rows = [
    // RDV tenu par Sami sur une campagne désormais pilotée par Jane.
    row('rdv-sami', resolveRowReferent(JANE, SAMI)),
    // Invitation en attente sur une campagne de Jane.
    row('attente-jane', resolveRowReferent(JANE, null)),
    // Campagne dont le référent a été désactivé.
    row('attente-parti', resolveRowReferent(PARTI, null)),
    // Campagne sans référent.
    row('attente-orphelin', resolveRowReferent(null, null)),
  ];
  const referentOf = (r: RowReferent) => r.referent;

  it('filtrer sur Sami retient le RDV qu’il TIENT, pas les campagnes de Jane', () => {
    const shown = filterByReferentBy(rows, referentOf, {
      kind: 'recruiter',
      id: SAMI.id,
    });
    expect(shown.map((r) => r.id)).toEqual(['rdv-sami']);
  });

  it('filtrer sur Jane ne ramène PAS le rendez-vous parti chez Sami', () => {
    const shown = filterByReferentBy(rows, referentOf, {
      kind: 'recruiter',
      id: JANE.id,
    });
    expect(shown.map((r) => r.id)).toEqual(['attente-jane']);
  });

  it('« Référent non défini » réunit le référent désactivé et la campagne sans référent', () => {
    const shown = filterByReferentBy(rows, referentOf, { kind: 'none' });
    expect(shown.map((r) => r.id)).toEqual(['attente-parti', 'attente-orphelin']);
  });

  it('« Tous » restaure l’intégralité', () => {
    const shown = filterByReferentBy(rows, referentOf, { kind: 'all' });
    expect(shown).toHaveLength(rows.length);
  });

  it('les comptes du sélecteur suivent le même découpage, et la somme est exhaustive', () => {
    const options = buildReferentOptionsBy(rows, referentOf);
    expect(options.map((o) => [o.label, o.count])).toEqual([
      ['Tous', 4],
      ['Jane R.', 1],
      ['Sami B.', 1],
      ['Référent non défini', 2],
    ]);
    const sum = options
      .filter((o) => o.selection.kind !== 'all')
      .reduce((acc, o) => acc + o.count, 0);
    expect(sum).toBe(rows.length);
  });

  it('« Mes campagnes » compte ce que le lecteur tient RÉELLEMENT', () => {
    expect(myReferentCountBy(rows, referentOf, SAMI.id)).toBe(1);
    expect(myReferentCountBy(rows, referentOf, JANE.id)).toBe(1);
    // Un recruteur désactivé n'est plus référent actif de rien.
    expect(myReferentCountBy(rows, referentOf, PARTI.id)).toBe(0);
    expect(myReferentCountBy(rows, referentOf, null)).toBe(0);
  });
});

describe('organizerEmailsByBooking (régime Cal.com)', () => {
  const entry = (payload: Record<string, unknown>) => ({ payload });

  it('retient l’organisateur de chaque réservation, normalisé', () => {
    const map = organizerEmailsByBooking([
      entry({ bookingUid: 'cal-1', organizerEmail: '  Sami@Example.TEST ' }),
      entry({ bookingUid: 'cal-2', organizerEmail: 'jane@example.test' }),
    ]);
    expect(map.get('cal-1')).toBe('sami@example.test');
    expect(map.get('cal-2')).toBe('jane@example.test');
  });

  it('la ligne la PLUS RÉCENTE gagne (entrées antichronologiques)', () => {
    const map = organizerEmailsByBooking([
      entry({ bookingUid: 'cal-1', organizerEmail: 'jane@example.test' }),
      entry({ bookingUid: 'cal-1', organizerEmail: 'sami@example.test' }),
    ]);
    expect(map.get('cal-1')).toBe('jane@example.test');
  });

  it('ignore les lignes du chemin natif (aucun organizerEmail) sans se casser', () => {
    const map = organizerEmailsByBooking([
      entry({ bookingUid: 'bk-native', status: 'delivered' }),
      entry({ organizerEmail: 'sami@example.test' }),
      entry({ bookingUid: 'cal-9', organizerEmail: '   ' }),
      entry({ bookingUid: 42, organizerEmail: 'x@example.test' }),
    ]);
    expect(map.size).toBe(0);
  });
});
