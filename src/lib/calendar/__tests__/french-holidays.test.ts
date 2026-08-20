/**
 * Jours fériés français.
 *
 * Les dates FIXES ne risquent rien ; ce sont les trois MOBILES qui se calculent
 * (Pâques, Ascension, Pentecôte) et qu'une erreur d'un jour rendrait fausses
 * sans que rien ne le signale — jusqu'à ce qu'un rendez-vous soit proposé un
 * jour férié. D'où deux angles complémentaires : des dates de référence, et
 * des invariants de jour de semaine qui tiennent pour TOUTE année.
 */
import { describe, expect, it } from 'vitest';

import {
  easterSunday,
  frenchHolidays,
  isoWeekday,
  upcomingFrenchHolidays,
} from '../french-holidays';

const LUNDI = 1;
const JEUDI = 4;

function dayOf(year: number, label: string): string {
  const found = frenchHolidays(year).find((h) => h.label === label);
  if (!found) throw new Error(`férié absent : ${label}`);
  return found.day;
}

describe('dimanche de Pâques', () => {
  it('retrouve les dates de référence', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
  });

  it('tombe toujours un dimanche, sur un siècle entier', () => {
    // Le test le plus utile du lot : il ne dépend d'aucune fixture et
    // attraperait un décalage d'un jour n'importe où dans le comput.
    for (let year = 1990; year <= 2090; year += 1) {
      expect(isoWeekday(easterSunday(year))).toBe(7);
    }
  });
});

describe('les 11 fériés métropolitains', () => {
  it('sont au complet et triés', () => {
    const days = frenchHolidays(2026).map((h) => h.day);
    expect(days).toHaveLength(11);
    expect([...days].sort()).toEqual(days);
  });

  it('place les dates fixes', () => {
    expect(dayOf(2026, 'Jour de l’An')).toBe('2026-01-01');
    expect(dayOf(2026, 'Fête du Travail')).toBe('2026-05-01');
    expect(dayOf(2026, 'Fête nationale')).toBe('2026-07-14');
    expect(dayOf(2026, 'Noël')).toBe('2026-12-25');
  });

  it('cale les mobiles sur Pâques 2026', () => {
    expect(dayOf(2026, 'Lundi de Pâques')).toBe('2026-04-06');
    expect(dayOf(2026, 'Ascension')).toBe('2026-05-14');
    expect(dayOf(2026, 'Lundi de Pentecôte')).toBe('2026-05-25');
  });

  it('respecte le jour de semaine des mobiles, quelle que soit l’année', () => {
    for (let year = 2020; year <= 2060; year += 1) {
      expect(isoWeekday(dayOf(year, 'Lundi de Pâques'))).toBe(LUNDI);
      expect(isoWeekday(dayOf(year, 'Ascension'))).toBe(JEUDI);
      expect(isoWeekday(dayOf(year, 'Lundi de Pentecôte'))).toBe(LUNDI);
    }
  });
});

describe('fériés à proposer', () => {
  it('ignore ceux déjà passés', () => {
    const days = upcomingFrenchHolidays({ from: '2026-08-20' }).map((h) => h.day);
    expect(days).not.toContain('2026-07-14');
    expect(days).toContain('2026-11-11');
  });

  it('couvre l’année en cours ET la suivante', () => {
    // L'horizon de réservation peut aller jusqu'à 365 jours : s'arrêter au
    // 31 décembre laisserait un trou en fin d'année.
    const days = upcomingFrenchHolidays({ from: '2026-08-20' }).map((h) => h.day);
    expect(days).toContain('2026-12-25');
    expect(days).toContain('2027-01-01');
  });

  it('écarte les fériés tombant un jour non travaillé', () => {
    // 1ᵉʳ novembre 2026 = dimanche ; 11 novembre 2026 = mercredi.
    const days = upcomingFrenchHolidays({
      from: '2026-08-20',
      openWeekdays: [1, 2, 3, 4, 5],
    }).map((h) => h.day);
    expect(days).not.toContain('2026-11-01');
    expect(days).toContain('2026-11-11');
  });

  it('est EXHAUSTIF sans filtre — le contrat du bouton', () => {
    // Incident 20/08/2026 : le bouton passait les jours travaillés du
    // recruteur en filtre. Chez quelqu'un ouvrant lun/mar/mer/sam, 6 fériés
    // sur 14 disparaissaient SANS RIEN DIRE — dont Noël 2026 (un vendredi) et
    // la Toussaint 2026 (un dimanche). Une ligne en trop se voit et se
    // retire ; une ligne manquante, non. Le filtre appartient au signal, pas
    // au bouton.
    const days = upcomingFrenchHolidays({ from: '2026-08-20' }).map((h) => h.day);
    expect(days).toHaveLength(14);
    expect(days).toContain('2026-12-25'); // vendredi
    expect(days).toContain('2026-11-01'); // dimanche
    expect(days).toContain('2027-05-08'); // samedi
  });

  it('ne filtre RIEN quand aucune règle n’est encore saisie', () => {
    // Un bouton qui ne rendrait rien sans raison visible serait pire qu'inutile.
    const days = upcomingFrenchHolidays({
      from: '2026-08-20',
      openWeekdays: [],
    }).map((h) => h.day);
    expect(days).toContain('2026-11-01');
  });
});
