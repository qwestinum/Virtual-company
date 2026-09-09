/**
 * Résumés des sections de réglages — PURS.
 *
 * Ce qui compte ici : les trois réglages qui cassent le pipeline EN SILENCE
 * doivent être signalés `warn` repliés. Un résumé qui dit « 3 adresses » alors
 * qu'aucune n'est cochée serait pire que pas de résumé du tout : il rassure.
 */
import { describe, expect, it } from 'vitest';

import {
  brandingSummary,
  channelsSummary,
  countWarnings,
  integrationsSummary,
  interviewSummary,
  resendSummary,
  senderSummary,
  synthesisSummary,
  vivierSummary,
  type SummarySource,
} from '@/lib/settings/section-summary';
import { DEFAULT_ADEP_CONFIG } from '@/types/adep-settings';
import { DEFAULT_BRANDING_CONFIG } from '@/types/branding';
import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';

function source(overrides: Partial<SummarySource> = {}): SummarySource {
  return {
    synthesisEmails: [],
    synthesisEmailsActive: [],
    senderEmail: null,
    senderEmails: [],
    resendApiKeyConfigured: false,
    interviewConfig: DEFAULT_INTERVIEW_CONFIG,
    vivierConfig: DEFAULT_VIVIER_CONFIG,
    brandingConfig: DEFAULT_BRANDING_CONFIG,
    adepConfig: DEFAULT_ADEP_CONFIG,
    fluxConfigured: 0,
    channelsConfigured: 0,
    ...overrides,
  };
}

describe('adresses de synthèse', () => {
  it('AUCUNE cochée alors que la liste est pleine ⇒ alerte, et le dit', () => {
    const state = synthesisSummary(
      source({ synthesisEmails: ['a@x.fr', 'b@x.fr'], synthesisEmailsActive: [] }),
    );
    expect(state.status).toBe('warn');
    expect(state.summary).toContain('2 adresses');
    expect(state.summary).toMatch(/ne partent nulle part/);
  });

  it('liste vide ⇒ alerte', () => {
    expect(synthesisSummary(source()).status).toBe('warn');
  });

  it('cochées ⇒ on lit QUI reçoit, pas seulement combien', () => {
    const state = synthesisSummary(
      source({
        synthesisEmails: ['a@x.fr', 'b@x.fr'],
        synthesisEmailsActive: ['a@x.fr'],
      }),
    );
    expect(state.status).toBe('ok');
    expect(state.summary).toContain('a@x.fr');
    expect(state.summary).toContain('1 destinataire sur 2');
  });
});

describe('service email', () => {
  it('sans clé ⇒ alerte explicite sur la conséquence', () => {
    const state = resendSummary(source());
    expect(state.status).toBe('warn');
    expect(state.summary).toMatch(/aucun mail candidat/i);
  });

  it('avec clé ⇒ ok, sans jamais afficher la valeur', () => {
    const state = resendSummary(source({ resendApiKeyConfigured: true }));
    expect(state.status).toBe('ok');
    expect(state.summary).toBe('Clé enregistrée');
  });
});

describe('entretiens', () => {
  it('sans lien d’agenda ⇒ alerte, en rappelant l’exception native', () => {
    const state = interviewSummary(source());
    expect(state.status).toBe('warn');
    expect(state.summary).toMatch(/réservation native/i);
  });

  it('avec lien ⇒ ok, et le nom d’organisation est en tête', () => {
    const state = interviewSummary(
      source({
        interviewConfig: {
          ...DEFAULT_INTERVIEW_CONFIG,
          agendaLink: 'https://cal.com/x',
          organisationName: 'Qwestinum',
        },
      }),
    );
    expect(state.status).toBe('ok');
    expect(state.summary).toContain('Qwestinum');
  });
});

describe('expéditeur, identité, vivier, intégrations', () => {
  it('expéditeur : l’adresse par défaut, et le reste compté', () => {
    const state = senderSummary(
      source({ senderEmail: 'a@x.fr', senderEmails: ['a@x.fr', 'b@x.fr', 'c@x.fr'] }),
    );
    expect(state.summary).toBe('a@x.fr (+2 autres)');
  });

  it('identité : rien de configuré n’est PAS une alerte (c’est facultatif)', () => {
    expect(brandingSummary(source()).status).toBe('neutral');
    expect(
      brandingSummary(source({ brandingConfig: { logoUrl: 'u', accentColor: '#000' } }))
        .summary,
    ).toBe('Personnalisée : logo + couleur');
  });

  it('vivier : le mode de contact, qui décide si un mail part tout seul', () => {
    expect(
      vivierSummary(source({ vivierConfig: { ...DEFAULT_VIVIER_CONFIG, contactMode: 'auto' } }))
        .summary,
    ).toMatch(/^Contact automatique/);
    expect(vivierSummary(source()).summary).toMatch(/après validation/);
  });

  it('intégrations : « n sur N », jamais un pourcentage vide de sens', () => {
    expect(integrationsSummary(0, 6).summary).toBe('Aucune intégration configurée');
    expect(integrationsSummary(2, 6).summary).toBe('2 configurées sur 6');
    expect(integrationsSummary(1, 6).summary).toBe('1 configurée sur 6');
  });
});

describe('countWarnings', () => {
  it('compte ce qui demande une action, pas ce qui est simplement vide', () => {
    const states = [
      synthesisSummary(source()),
      resendSummary(source()),
      brandingSummary(source()),
      vivierSummary(source()),
    ];
    expect(countWarnings(states)).toBe(2);
  });
});

describe('channelsSummary — les réglages APEC ne se découvrent pas au fond d’une campagne', () => {
  const READY = {
    ...DEFAULT_ADEP_CONFIG,
    nafCode: '7810Z',
    organizationDescription: 'x'.repeat(120),
  };

  it('signale ce qui manque, replié', () => {
    // Un « 0 configurée sur 4 » cacherait qu'il manque un code NAF, et on
    // l'apprendrait en butant sur un bouton désarmé.
    const state = channelsSummary(source(), 2);
    expect(state.status).toBe('warn');
    expect(state.summary).toContain('code NAF');
    expect(state.summary).toContain("description de l'entreprise");
  });

  it('ne signale plus rien une fois les deux réglages posés', () => {
    const state = channelsSummary(source({ adepConfig: READY }), 2);
    expect(state.status).toBe('ok');
    expect(state.summary).toContain('APEC prêt');
  });

  it('une description trop courte compte comme absente', () => {
    // L'Apec exige 100 caractères (API_407) : 40 caractères ne passent pas,
    // et l'écran doit le dire ici, pas au moment de publier.
    const short = { ...READY, organizationDescription: 'Cabinet de recrutement.' };
    expect(channelsSummary(source({ adepConfig: short }), 2).status).toBe('warn');
  });
});
