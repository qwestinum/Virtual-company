import { describe, expect, it } from 'vitest';

import {
  agendaFieldNotices,
  summarizeAgendaStatus,
  type AgendaStatus,
} from '@/lib/interview/agenda-status';

const status = (over: Partial<AgendaStatus> = {}): AgendaStatus => ({
  native: 0,
  nativeBlocked: 0,
  externalOnField: 0,
  envFallback: false,
  ...over,
});

const tones = (notices: { tone: string }[]) => notices.map((n) => n.tone);

describe('summarizeAgendaStatus', () => {
  it('compte les natives, les natives bloquées et les externes qui reposent sur le champ', () => {
    expect(
      summarizeAgendaStatus(
        [
          { regime: 'native', bookable: true },
          { regime: 'native', bookable: false },
          { regime: 'external', source: 'field' },
          { regime: 'external', source: 'referent' },
        ],
        false,
      ),
    ).toEqual({ native: 2, nativeBlocked: 1, externalOnField: 1, envFallback: false });
  });
});

describe('agendaFieldNotices — l’écran dit l’état des campagnes, jamais celui du champ', () => {
  it('instance neuve, tout en natif, disponibilités remplies, lien externe vide ⇒ AUCUN avertissement', () => {
    const notices = agendaFieldNotices(status({ native: 3 }), '');
    expect(tones(notices)).toEqual(['ok']);
  });

  it('aucune campagne encore ⇒ rien à dire (l’agenda interne suffit)', () => {
    expect(agendaFieldNotices(status(), '')).toEqual([]);
  });

  it('natif sans disponibilités ⇒ l’avertissement porte sur les DISPONIBILITÉS, pas sur le lien', () => {
    const notices = agendaFieldNotices(status({ native: 2, nativeBlocked: 1 }), '');
    const warn = notices.filter((n) => n.tone === 'warn');
    expect(warn).toHaveLength(1);
    expect(warn[0]?.text).toContain('disponibilités');
    expect(warn[0]?.text).not.toContain('lien externe');
  });

  it('réservation native désactivée et aucun lien ⇒ bloquant tant que le lien est vide', () => {
    const blocked = agendaFieldNotices(status({ externalOnField: 1 }), '');
    expect(tones(blocked)).toEqual(['warn']);
    expect(blocked[0]?.text).toContain('1 campagne active a la réservation native désactivée');
    expect(agendaFieldNotices(status({ externalOnField: 1 }), 'https://cal.com/x')).toEqual([]);
  });

  it('un lien de secours hors écran couvre ces campagnes', () => {
    expect(agendaFieldNotices(status({ externalOnField: 2, envFallback: true }), '')).toEqual([]);
  });

  it('état indisponible ⇒ rien (ni fausse alarme, ni faux « tout va bien »)', () => {
    expect(agendaFieldNotices(null, '')).toEqual([]);
  });

  it('accord du pluriel', () => {
    expect(agendaFieldNotices(status({ native: 1 }), '')[0]?.text).toContain('1 campagne active invite');
    expect(agendaFieldNotices(status({ native: 4 }), '')[0]?.text).toContain('4 campagnes actives invitent');
  });
});
