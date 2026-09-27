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

  it('compte les envois automatiques ET ceux validés par le recruteur (défaut du 27/09)', () => {
    const actions = mail?.sources.map((s) => s.action);
    expect(actions).toContain('imap_outreach_mail');
    // L'acceptation envoyée après une décision humaine : absente, le compteur
    // restait à 0 juste après un envoi.
    expect(actions).toContain('hitl_validation_sent');
  });

  it('ne compte que les mails PARTIS — jamais une tentative échouée ni un envoi sauté', () => {
    for (const src of mail?.sources ?? []) {
      expect(src.payloadEquals, src.action).toBeDefined();
    }
    expect(mail?.sources.find((s) => s.action === 'imap_outreach_mail')?.payloadEquals).toEqual({
      status: 'sent',
    });
    expect(mail?.sources.find((s) => s.action === 'hitl_validation_sent')?.payloadEquals).toEqual({
      mailSent: 'true',
    });
  });
});
