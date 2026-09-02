/**
 * Les arrêts — et surtout LA FORME de leur message.
 *
 * Ces tests portent autant sur la langue que sur la logique : le message est lu
 * par le responsable de traitement, pas par un développeur. « conflit d'état
 * sur interview_briefs » ne se traite pas ; « un entretien est programmé le 3
 * septembre à 10 h, annulez-le ou confirmez par écrit que l'effacement prime »
 * se traite.
 */
import { describe, expect, it } from 'vitest';

import { detectBlockers, needsHumanDecision } from '@/lib/gdpr/blockers';

const NONE = {
  scheduledInterviews: [],
  confirmedBookings: [],
  sendingValidations: [],
};

describe('detectBlockers', () => {
  it('ne bloque rien quand rien ne s’y oppose', () => {
    expect(detectBlockers(NONE)).toEqual([]);
  });

  it('nomme la date, la campagne, et RENVOIE la décision au client', () => {
    const [b] = detectBlockers({
      ...NONE,
      scheduledInterviews: [
        {
          ref: 'interview_briefs#abc',
          startAt: '2026-09-03T08:00:00.000Z',
          campaignId: 'CAMP-2026-051',
        },
      ],
    });
    expect(b!.message).toContain('3 septembre 2026');
    expect(b!.message).toContain('10:00'); // Europe/Paris, pas UTC
    expect(b!.message).toContain('CAMP-2026-051');
    expect(b!.message).toContain('responsable de traitement');
    expect(b!.message).toContain('confirmer par écrit');
    // Aucun nom de table, aucun code, aucun anglicisme technique.
    expect(b!.message).not.toContain('interview_briefs');
    expect(b!.ref).toBe('interview_briefs#abc');
  });

  it('dit franchement qu’une date manque plutôt que d’en inventer une', () => {
    const [b] = detectBlockers({
      ...NONE,
      scheduledInterviews: [{ ref: 'x', startAt: null, campaignId: null }],
    });
    expect(b!.message).toContain('date non renseignée');
  });

  it('traite un rendez-vous réservé comme un entretien programmé', () => {
    const [b] = detectBlockers({
      ...NONE,
      confirmedBookings: [
        { ref: 'sched_bookings#1', startAt: '2026-09-03T08:00:00.000Z', campaignId: 'CAMP-1' },
      ],
    });
    expect(b!.kind).toBe('booking_confirmed');
    expect(needsHumanDecision(b!)).toBe(true);
  });

  it('un envoi en cours n’appelle PAS le client — il se lève seul', () => {
    const [b] = detectBlockers({
      ...NONE,
      sendingValidations: [{ ref: 'pending_validations#1', since: '2026-09-02T10:00:00.000Z' }],
    });
    expect(needsHumanDecision(b!)).toBe(false);
    expect(b!.message).toContain('quelques minutes');
    expect(b!.message).toContain('aucune intervention');
  });

  it('remonte TOUS les arrêts, pas seulement le premier', () => {
    const all = detectBlockers({
      scheduledInterviews: [{ ref: 'a', startAt: null, campaignId: null }],
      confirmedBookings: [{ ref: 'b', startAt: '2026-09-03T08:00:00.000Z', campaignId: null }],
      sendingValidations: [{ ref: 'c', since: null }],
    });
    expect(all.map((b) => b.kind)).toEqual([
      'interview_scheduled',
      'booking_confirmed',
      'validation_sending',
    ]);
  });
});
