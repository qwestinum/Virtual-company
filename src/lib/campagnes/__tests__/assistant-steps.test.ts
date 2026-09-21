import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_STEPS,
  canReach,
  nextStep,
  parseStep,
  prevStep,
  resumeStep,
  STEP_RAIL_LABELS,
  validateStep,
  type AssistantFacts,
} from '@/lib/campagnes/assistant-steps';
import { MOTS_BANNIS_A_L_ECRAN } from '@/lib/lexique/phrases-ecran';

/** Un brouillon complet : chaque test ne casse QUE ce qu'il examine. */
function faits(over: Partial<AssistantFacts> = {}): AssistantFacts {
  return {
    jobTitle: 'Développeur back end',
    missingFdpLabels: [],
    criteriaCount: 4,
    untreatedSuggestions: 0,
    sourceCount: 2,
    emailSource: true,
    mailboxCount: 1,
    thresholdLow: 40,
    thresholdHigh: 75,
    schedulingNative: true,
    ownerHasAvailability: true,
    meetingLocationComplete: true,
    ...over,
  };
}

describe('quand une étape bloque, elle DIT quoi', () => {
  it('l’intitulé manquant est nommé', () => {
    const v = validateStep('poste', faits({ jobTitle: '   ' }));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toContain('intitulé du poste');
  });

  it('une fiche de poste incomplète NOMME les champs, et compte au-delà de trois', () => {
    // Sans ça, on arriverait au récapitulatif pour y trouver un « Activer »
    // qui échoue : un mur à la fin, quand tout le reste est saisi.
    const trois = validateStep(
      'poste',
      faits({ missingFdpLabels: ['Séniorité', 'Localisation', 'Missions principales'] }),
    );
    expect(!trois.ok && trois.reason).toBe(
      'Il manque : Séniorité, Localisation, Missions principales.',
    );
    const cinq = validateStep(
      'poste',
      faits({ missingFdpLabels: ['A', 'B', 'C', 'D', 'E'] }),
    );
    expect(!cinq.ok && cinq.reason).toBe('Il manque : A, B, C et 2 autres.');
  });

  it('une pondération proposée par l’IA retient, et on compte', () => {
    const un = validateStep('criteres', faits({ untreatedSuggestions: 1 }));
    expect(!un.ok && un.reason).toBe(
      '1 pondération proposée par l’IA reste à confirmer ou à écarter.',
    );
    const trois = validateStep('criteres', faits({ untreatedSuggestions: 3 }));
    expect(!trois.ok && trois.reason).toBe(
      '3 pondérations proposées par l’IA restent à confirmer ou à écarter.',
    );
  });

  it('le flux email sans boîte est un blocage NOMMÉ, pas un silence', () => {
    const v = validateStep('reception', faits({ emailSource: true, mailboxCount: 0 }));
    expect(!v.ok && v.reason).toContain('boîte mail');
  });

  it('un flux email retiré lève le blocage', () => {
    expect(
      validateStep('reception', faits({ emailSource: false, mailboxCount: 0 })).ok,
    ).toBe(true);
  });

  it('les deux notes inversées sont rendues telles qu’elles sont', () => {
    const v = validateStep('suivi', faits({ thresholdLow: 80, thresholdHigh: 20 }));
    expect(!v.ok && v.reason).toContain('(80)');
    expect(!v.ok && v.reason).toContain('(20)');
  });

  it('AUCUNE raison n’emploie un mot interdit à l’écran', () => {
    const raisons = [
      validateStep('poste', faits({ jobTitle: '' })),
      validateStep('poste', faits({ missingFdpLabels: ['Séniorité'] })),
      validateStep('criteres', faits({ criteriaCount: 0 })),
      validateStep('criteres', faits({ untreatedSuggestions: 2 })),
      validateStep('reception', faits({ sourceCount: 0 })),
      validateStep('reception', faits({ mailboxCount: 0 })),
      validateStep('suivi', faits({ thresholdLow: 90, thresholdHigh: 10 })),
      validateStep('reservation', faits({ ownerHasAvailability: false })),
      validateStep('reservation', faits({ meetingLocationComplete: false })),
    ]
      .filter((v): v is { ok: false; reason: string } => !v.ok)
      .map((v) => v.reason.toLowerCase());
    expect(raisons).toHaveLength(9);
    for (const r of raisons) {
      for (const mot of MOTS_BANNIS_A_L_ECRAN) {
        expect(r, `« ${mot} » dans « ${r} »`).not.toContain(mot);
      }
    }
  });

  it('les libellés du rail non plus', () => {
    for (const libelle of Object.values(STEP_RAIL_LABELS)) {
      for (const mot of MOTS_BANNIS_A_L_ECRAN) {
        expect(libelle.toLowerCase()).not.toContain(mot);
      }
    }
  });
});

describe('une ignorance ne bloque JAMAIS', () => {
  it('disponibilités inconnues (module injoignable) laissent passer', () => {
    // Opposer « je ne sais pas » à quelqu'un qui avance, c'est l'arrêter sur
    // une panne qui n'est pas la sienne.
    expect(
      validateStep('reservation', faits({ ownerHasAvailability: null })).ok,
    ).toBe(true);
  });

  it('en Cal.com, les disponibilités du référent ne regardent personne', () => {
    expect(
      validateStep(
        'reservation',
        faits({ schedulingNative: false, ownerHasAvailability: false }),
      ).ok,
    ).toBe(true);
  });
});

describe('le rail ne laisse pas sauter un trou', () => {
  it('sans intitulé, seule la première étape est atteignable', () => {
    const f = faits({ jobTitle: '' });
    expect(canReach('poste', f)).toBe(true);
    expect(canReach('criteres', f)).toBe(false);
    expect(canReach('recapitulatif', f)).toBe(false);
  });

  it('revenir en arrière est toujours permis', () => {
    // Le trou est à l'étape 3 : les étapes 1 et 2 restent atteignables.
    const f = faits({ sourceCount: 0 });
    expect(canReach('poste', f)).toBe(true);
    expect(canReach('criteres', f)).toBe(true);
    expect(canReach('reception', f)).toBe(true);
    expect(canReach('suivi', f)).toBe(false);
  });

  it('tout réglé : le récapitulatif est atteignable', () => {
    expect(canReach('recapitulatif', faits())).toBe(true);
  });
});

describe('rouvrir un brouillon dépose là où il reste à faire', () => {
  it('sur la PREMIÈRE étape non valide', () => {
    expect(resumeStep(faits({ sourceCount: 0 }))).toBe('reception');
    expect(resumeStep(faits({ jobTitle: '' }))).toBe('poste');
  });

  it('un brouillon complet reprend au récapitulatif — le geste qui reste', () => {
    expect(resumeStep(faits())).toBe('recapitulatif');
  });

  it('le PREMIER trou gagne, pas le dernier', () => {
    expect(resumeStep(faits({ criteriaCount: 0, sourceCount: 0 }))).toBe('criteres');
  });
});

describe('navigation et adresse', () => {
  it('l’ordre est celui du tableau, et il boucle nulle part', () => {
    expect(ASSISTANT_STEPS).toHaveLength(6);
    expect(prevStep('poste')).toBeNull();
    expect(nextStep('recapitulatif')).toBeNull();
    expect(nextStep('poste')).toBe('criteres');
    expect(prevStep('recapitulatif')).toBe('reservation');
  });

  it('une étape inconnue dans l’adresse ne casse rien', () => {
    expect(parseStep('vivier')).toBeNull();
    expect(parseStep(null)).toBeNull();
    expect(parseStep('suivi')).toBe('suivi');
  });
});
