import { describe, expect, it } from 'vitest';

import { AGENT_BAND, bandWindowStart, parseBandWindow } from '@/lib/today/agents-band';

const JOUR = 86_400_000;
const MAINTENANT = Date.parse('2026-09-22T10:00:00.000Z');

describe('fenêtre de la bande d’équipe', () => {
  it('ne reconnaît que « mois » ; tout le reste vaut la semaine', () => {
    // Une valeur venue de l'URL n'est pas une fenêtre : elle ne choisit
    // jamais une durée qu'on n'a pas nommée.
    expect(parseBandWindow('mois')).toBe('mois');
    expect(parseBandWindow('semaine')).toBe('semaine');
    for (const brut of [null, '', 'MOIS', 'annee', '30', ' mois']) {
      expect(parseBandWindow(brut), String(brut)).toBe('semaine');
    }
  });

  it('la semaine remonte de 7 jours, le mois de 30', () => {
    expect(bandWindowStart(MAINTENANT, 'semaine')).toBe(
      new Date(MAINTENANT - 7 * JOUR).toISOString(),
    );
    expect(bandWindowStart(MAINTENANT, 'mois')).toBe(
      new Date(MAINTENANT - 30 * JOUR).toISOString(),
    );
  });

  it('sans fenêtre dite, c’est la semaine', () => {
    expect(bandWindowStart(MAINTENANT)).toBe(bandWindowStart(MAINTENANT, 'semaine'));
  });
});

describe('Mail Composer — un message ENVOYÉ, quelle que soit la porte', () => {
  const mail = AGENT_BAND.find((a) => a.id === 'agent.mail-composer');

  it('compte TOUS les mails écrits à un candidat (défaut du 27/09)', () => {
    const actions = mail?.sources.map((s) => s.action);
    // Absentes, le compteur restait à 0 juste après un envoi.
    expect(actions).toEqual(
      expect.arrayContaining([
        'imap_outreach_mail', // envoi automatique
        'hitl_validation_sent', // envoi après la décision du recruteur
        'interview_link_reissued', // invitation renvoyée depuis Entretiens
        'candidature_dismissed', // avis de classement sans suite
        'vivier_invitation_sent', // invitation à candidater (vivier)
      ]),
    );
  });

  it('ne compte que les mails PARTIS — jamais une tentative échouée ni un envoi sauté', () => {
    for (const src of mail?.sources ?? []) {
      expect(src.payloadEquals, src.action).toBeDefined();
    }
    expect(mail?.sources.find((s) => s.action === 'imap_outreach_mail')?.payloadEquals).toEqual({
      status: 'sent',
    });
    for (const action of ['hitl_validation_sent', 'interview_link_reissued', 'candidature_dismissed']) {
      expect(mail?.sources.find((s) => s.action === action)?.payloadEquals, action).toEqual({
        mailSent: 'true',
      });
    }
    expect(mail?.sources.find((s) => s.action === 'vivier_invitation_sent')?.payloadEquals).toEqual({
      status: 'sent',
    });
  });
});
