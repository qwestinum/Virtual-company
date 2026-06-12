import { describe, expect, it } from 'vitest';

import {
  acceptanceSubject,
  interviewMailTextToHtml,
  rejectionSubject,
  renderInterviewMail,
  splitCandidateName,
  type InterviewMailVars,
} from '@/lib/interview/mail-templates';
import {
  DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE,
  DEFAULT_INTERVIEW_REJECTION_TEMPLATE,
} from '@/types/interview-settings';

const VARS: InterviewMailVars = {
  prenom: 'Alice',
  nom: 'Martin',
  jobTitle: 'Comptable',
  campaignName: 'Recrutement Compta 2026',
  organisation: 'Qwestinum',
  recruiterName: 'Camille Roux',
  agendaLink: 'https://cal.com/qwestinum/entretien',
};

describe('splitCandidateName', () => {
  it('sépare prénom (1er token) et nom (reste)', () => {
    expect(splitCandidateName('Alice Martin')).toEqual({
      prenom: 'Alice',
      nom: 'Martin',
    });
    expect(splitCandidateName('Jean-Pierre De La Tour')).toEqual({
      prenom: 'Jean-Pierre',
      nom: 'De La Tour',
    });
  });

  it('gère un nom mono-token et les espaces multiples', () => {
    expect(splitCandidateName('  Madonna ')).toEqual({
      prenom: 'Madonna',
      nom: '',
    });
    expect(splitCandidateName('Alice   Martin')).toEqual({
      prenom: 'Alice',
      nom: 'Martin',
    });
  });
});

describe('renderInterviewMail — acceptation', () => {
  it('substitue toutes les variables du socle + le lien d’agenda', () => {
    const out = renderInterviewMail(DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE, VARS);
    expect(out).toContain('Bonjour Alice,');
    expect(out).toContain('Comptable');
    expect(out).toContain('https://cal.com/qwestinum/entretien');
    expect(out).toContain('Camille Roux');
    expect(out).toContain('Qwestinum');
    // Aucun placeholder résiduel.
    expect(out).not.toMatch(/\[[^\]]+\]/);
  });

  it('ne contient AUCUNE info de RDV (date/heure/lieu/durée)', () => {
    const out = renderInterviewMail(DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE, VARS);
    expect(out).not.toMatch(/\d{1,2}h\d{0,2}/); // pas d'heure type 14h30
    expect(out).not.toMatch(/durée|minutes|\b30 min\b/i);
    expect(out).not.toMatch(/adresse|lieu|salle/i);
  });

  it('accepte le placeholder [lien d’agenda] avec apostrophe typographique', () => {
    const tpl = 'Réservez ici : [lien d’agenda]';
    expect(renderInterviewMail(tpl, VARS)).toBe(
      'Réservez ici : https://cal.com/qwestinum/entretien',
    );
  });

  it('accepte aussi l’apostrophe droite [lien d\'agenda]', () => {
    const tpl = "Réservez ici : [lien d'agenda]";
    expect(renderInterviewMail(tpl, VARS)).toBe(
      'Réservez ici : https://cal.com/qwestinum/entretien',
    );
  });
});

describe('renderInterviewMail — refus', () => {
  it('substitue le socle commun et n’expose pas de motif interne', () => {
    const out = renderInterviewMail(DEFAULT_INTERVIEW_REJECTION_TEMPLATE, {
      ...VARS,
      agendaLink: '',
    });
    expect(out).toContain('Bonjour Alice,');
    expect(out).toContain('Comptable');
    expect(out).toContain('Camille Roux');
    expect(out).not.toMatch(/\[[^\]]+\]/);
    // Pas de lien d'agenda dans un refus.
    expect(out).not.toContain('cal.com');
  });
});

describe('interviewMailTextToHtml', () => {
  it('échappe le HTML, rend des paragraphes et rend le lien cliquable', () => {
    const html = interviewMailTextToHtml(
      'Bonjour Alice,\n\nVoici le lien : https://cal.com/x\n\n<script>',
    );
    expect(html).toContain('<p>Bonjour Alice,</p>');
    expect(html).toContain(
      '<a href="https://cal.com/x">https://cal.com/x</a>',
    );
    // Balise injectée échappée, pas exécutable.
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('subjects déterministes', () => {
  it('acceptation et refus incluent le poste quand fourni', () => {
    expect(acceptanceSubject('Comptable')).toContain('Comptable');
    expect(rejectionSubject('Comptable')).toContain('Comptable');
  });

  it('repli sans poste', () => {
    expect(acceptanceSubject(null)).toBe(
      'Votre candidature a retenu notre attention',
    );
    expect(rejectionSubject(null)).toBe('Votre candidature');
  });
});
