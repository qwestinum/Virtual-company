import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  dismissalMotif,
  FEEDBACK_TEMPLATE_FIELD,
  finalizeFeedbackText,
  proposeFeedbackMessage,
  recruiterFirstName,
  unresolvedPlaceholders,
  type FeedbackTemplateVars,
} from '@/lib/candidatures/feedback-template';
import { FEEDBACK_KINDS } from '@/types/candidate-feedback';
import { DISMISSAL_REASONS } from '@/types/dismissal';
import {
  DEFAULT_FEEDBACK_NEXT_STEP,
  DEFAULT_INTERVIEW_CONFIG,
  InterviewConfigSchema,
} from '@/types/interview-settings';

const VARS: FeedbackTemplateVars = {
  prenom: 'Awa',
  jobTitle: 'Chef de projet MOA',
  organisation: 'Cabinet Exemple',
  recruiterFirstName: 'Sami',
  recruiterName: 'Sami Benali',
  motif: dismissalMotif('poste_pourvu') ?? '',
};

describe('gabarits par défaut', () => {
  it.each(FEEDBACK_KINDS)('« %s » se rend sans variable résiduelle', (kind) => {
    const { subject, body } = proposeFeedbackMessage(kind, DEFAULT_INTERVIEW_CONFIG, VARS);
    expect(subject).toBe('Votre candidature — Chef de projet MOA');
    expect(unresolvedPlaceholders(body)).toEqual([]);
    expect(body).toContain('Bonjour Awa,');
    expect(body).toContain('Chef de projet MOA');
    expect(body.endsWith('Sami\nCabinet Exemple')).toBe(true);
    expect(body).not.toMatch(/\n{3,}/);
  });

  it('ne promettent jamais une embauche (retenu = suite du processus)', () => {
    const { body } = proposeFeedbackMessage('retenu', DEFAULT_INTERVIEW_CONFIG, VARS);
    expect(body).toMatch(/suite du processus/);
    expect(body).not.toMatch(/embauch|recrut[ée] au poste|contrat|poste vous est/i);
  });

  it('l’absent n’est pas remercié pour un entretien qui n’a pas eu lieu', () => {
    const { body } = proposeFeedbackMessage('absent', DEFAULT_INTERVIEW_CONFIG, VARS);
    expect(body).not.toMatch(/notre entretien|notre échange/);
  });

  it('« sans suite » ne formule aucun refus', () => {
    const { body } = proposeFeedbackMessage('sans_suite', DEFAULT_INTERVIEW_CONFIG, VARS);
    expect(body).toContain('Le poste a été pourvu');
    expect(body).not.toMatch(/ne pas poursuivre|pas retenu|refus/i);
  });

  it('pas de bloc « cet outil ne décide pas » : le message est du recruteur', () => {
    for (const kind of FEEDBACK_KINDS) {
      const { body } = proposeFeedbackMessage(kind, DEFAULT_INTERVIEW_CONFIG, VARS);
      expect(body).not.toMatch(/outil|automatique|intelligence artificielle|\bIA\b/i);
    }
  });

  it('une configuration enregistrée avant ces champs reçoit les défauts', () => {
    const legacy = {
      acceptanceTemplate: 'a',
      rejectionTemplate: 'r',
      agendaLink: '',
      organisationName: '',
      recruiterName: '',
    };
    const parsed = InterviewConfigSchema.parse(legacy);
    for (const kind of FEEDBACK_KINDS) {
      const field = FEEDBACK_TEMPLATE_FIELD[kind];
      expect(parsed[field]).toBe(DEFAULT_INTERVIEW_CONFIG[field]);
    }
  });
});

describe('variables', () => {
  it('[prochaine étape] vide ⇒ phrase de repli', () => {
    const { body } = proposeFeedbackMessage('retenu', DEFAULT_INTERVIEW_CONFIG, {
      ...VARS,
      nextStep: '   ',
    });
    expect(body).toContain(DEFAULT_FEEDBACK_NEXT_STEP);
  });

  it('[prochaine étape] saisie ⇒ reprise telle quelle', () => {
    const { body } = proposeFeedbackMessage('retenu', DEFAULT_INTERVIEW_CONFIG, {
      ...VARS,
      nextStep: 'Vous rencontrerez le client jeudi.',
    });
    expect(body).toContain('Vous rencontrerez le client jeudi.');
    expect(body).not.toContain(DEFAULT_FEEDBACK_NEXT_STEP);
  });

  it('[prénom du recruteur] n’est pas mangé par [prénom]', () => {
    const { body } = proposeFeedbackMessage(
      'non_retenu',
      { ...DEFAULT_INTERVIEW_CONFIG, feedbackNotRetainedTemplate: '[prénom] / [prénom du recruteur]' },
      VARS,
    );
    expect(body).toBe('Awa / Sami');
  });

  it('une variable inconnue est SIGNALÉE, pas avalée', () => {
    expect(unresolvedPlaceholders('Bonjour [prenom], voir [lien]')).toEqual(['[prenom]', '[lien]']);
  });

  it('prénom du recruteur tiré du nom affiché', () => {
    expect(recruiterFirstName('Jane Rivière')).toBe('Jane');
    expect(recruiterFirstName('  ')).toBe('');
  });

  it('motif : jamais de message pour doublon/invalide, une phrase pour les autres', () => {
    for (const r of DISMISSAL_REASONS) {
      const m = dismissalMotif(r);
      if (r === 'doublon' || r === 'invalide') expect(m).toBeNull();
      else expect(m && m.length > 10).toBe(true);
    }
  });

  it('la mention RGPD est apposée une fois, hors gabarit', () => {
    const once = finalizeFeedbackText('Bonjour', 'rh@exemple.fr');
    expect(finalizeFeedbackText(once, 'rh@exemple.fr')).toBe(once);
    expect(once).toContain('rh@exemple.fr');
  });
});

describe('garde structurelle — le commentaire du recruteur ne peut pas entrer', () => {
  const SRC = readFileSync(resolve(__dirname, '../feedback-template.ts'), 'utf8');

  it('le module n’importe ni commentaire, ni compte rendu, ni verdict, ni analyse', () => {
    const imports = [...SRC.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(imp).not.toMatch(/verdict|interview-report|comment|candidate-analys|reporting|db\//);
    }
  });

  it('les variables forment une liste FERMÉE', () => {
    const block = SRC.slice(SRC.indexOf('export type FeedbackTemplateVars'));
    const fields = [...block.slice(0, block.indexOf('}>;')).matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(
      ['jobTitle', 'motif', 'nextStep', 'organisation', 'prenom', 'recruiterFirstName', 'recruiterName'].sort(),
    );
  });

  it('le type refuse un champ « commentaire » à la compilation', () => {
    // @ts-expect-error — aucun champ libre du dossier n'est une variable.
    const bad: FeedbackTemplateVars = { ...VARS, comment: 'réserves sur la mobilité' };
    expect(bad).toBeDefined();
  });
});
