/**
 * État de l'agenda publié et messages au recruteur — tests PURS.
 */
import { describe, expect, it } from 'vitest';

import {
  buildBusyCalendarBlockedEmail,
  buildBusyCalendarSignalMessage,
  causeOfFailure,
  classifyBusyCalendarState,
  isBusyCalendarSignalDue,
} from '../state';

describe('classifyBusyCalendarState', () => {
  const failing = { failing: true, readAt: '2026-09-14T07:00:00.000Z', toleranceMinutes: 120 };

  it('sain dès que la dernière lecture a réussi', () => {
    expect(
      classifyBusyCalendarState({ ...failing, failing: false, workingMinutesSinceRead: 9_999 }),
    ).toBe('healthy');
  });

  it('toléré jusqu’à 2 h ouvrées incluses, bloqué au-delà', () => {
    expect(classifyBusyCalendarState({ ...failing, workingMinutesSinceRead: 120 })).toBe('tolerated');
    expect(classifyBusyCalendarState({ ...failing, workingMinutesSinceRead: 121 })).toBe('blocked');
  });

  it('bloqué d’emblée quand l’agenda n’a jamais été lu', () => {
    expect(classifyBusyCalendarState({ ...failing, readAt: null, workingMinutesSinceRead: null })).toBe('blocked');
  });
});

describe('isBusyCalendarSignalDue', () => {
  it('s’allume au-delà d’1 h ouvrée — donc toujours avant la suspension', () => {
    const base = { failing: true, readAt: '2026-09-14T07:00:00.000Z' };
    expect(isBusyCalendarSignalDue({ ...base, workingMinutesSinceRead: 60 })).toBe(false);
    expect(isBusyCalendarSignalDue({ ...base, workingMinutesSinceRead: 61 })).toBe(true);
    expect(isBusyCalendarSignalDue({ ...base, failing: false, workingMinutesSinceRead: 500 })).toBe(false);
    expect(isBusyCalendarSignalDue({ failing: true, readAt: null, workingMinutesSinceRead: null })).toBe(true);
  });
});

describe('messages au recruteur', () => {
  it('rattache chaque code à une action compréhensible', () => {
    expect(causeOfFailure('not_calendar')).toBe('unpublished');
    expect(causeOfFailure('http_status')).toBe('unpublished');
    expect(causeOfFailure('suspicious_empty')).toBe('unpublished');
    expect(causeOfFailure('parse_error')).toBe('unreadable');
    expect(causeOfFailure('timeout')).toBe('unreachable');
    expect(causeOfFailure('decrypt_failed')).toBe('link');
    expect(causeOfFailure('redirect_refused')).toBe('link');
    expect(causeOfFailure(null)).toBe('link');
  });

  it('le signal dit l’état ET quoi faire, sans jargon', () => {
    const tolerated = buildBusyCalendarSignalMessage({
      state: 'tolerated',
      readAt: '2026-09-14T12:05:00.000Z',
      failureCode: 'not_calendar',
      timeZone: 'Europe/Paris',
    });
    expect(tolerated).toContain('dernière lecture à 14h05');
    expect(tolerated).toContain('Tes créneaux restent proposés');
    expect(tolerated).toContain('Republie ton agenda');

    const blocked = buildBusyCalendarSignalMessage({
      state: 'blocked',
      readAt: null,
      failureCode: 'not_calendar',
      timeZone: 'Europe/Paris',
    });
    expect(blocked).toContain('ne sont plus proposés');
    for (const message of [tolerated, blocked]) {
      expect(message).not.toMatch(/ICS|HTTP|not_calendar|404|URL/);
    }
  });

  it('l’email dit depuis quand, la conséquence, quoi faire, et où', () => {
    const mail = buildBusyCalendarBlockedEmail({
      displayName: 'Camille <Test>',
      failureCode: 'http_status',
      failingSince: '2026-09-14T07:42:00.000Z',
      timeZone: 'Europe/Paris',
      settingsUrl: 'https://orqa.exemple.fr/settings',
    });
    expect(mail.subject).toBe('Tes créneaux d’entretien ne sont plus proposés');
    expect(mail.html).toContain('lundi 14 septembre à 09:42');
    expect(mail.html).toContain('momentanément indisponibles');
    expect(mail.html).toContain('Republie ton agenda');
    expect(mail.html).toContain('href="https://orqa.exemple.fr/settings"');
    expect(mail.html).toContain('Camille &lt;Test&gt;');
    expect(mail.html).not.toMatch(/http_status|ICS|HTTP/);
  });
});
