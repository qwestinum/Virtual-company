/**
 * Page d'atterrissage — ce que la personne voit (spec §9.2, §14.5-14.6),
 * vérifié sur le HTML rendu.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingForm } from '@/components/sourcing-landing/LandingForm';
import { LandingOutcome } from '@/components/sourcing-landing/LandingOutcome';
import { ParcoursEditor } from '@/components/sourcing-landing/ParcoursEditor';
import { LandingNotice } from '@/components/sourcing-landing/LandingShell';
import { initialSubmission } from '@/lib/sourcing/landing';
import type { LandingView } from '@/lib/sourcing/server/landing-context';
import type { ExaSnapshot } from '@/types/sourcing';

const snapshot = {
  url: 'https://www.linkedin.com/in/claire', name: 'Claire Martin', firstName: 'Claire', location: 'Paris', headline: null,
  current: null, workHistory: [{ title: 'Business Analyst digital', company: 'Banque X', location: 'Paris', from: '2023-05-01', to: null }],
  education: [{ degree: 'Master SI', institution: 'Université W', from: '2014', to: '2016' }],
  about: 'Business Analyst sur les parcours digitaux.', skills: 'UML', languages: null, certifications: null,
  highlight: 'du cadrage à la recette', indexedAt: null, contacts: { emails: ['claire.martin@exemple.fr'] },
  availability: { expression: 'à l’écoute du marché', zone: 'about' },
} as unknown as ExaSnapshot;

const view: LandingView = {
  organizationName: 'Cabinet Conseil', logoUrl: null, accentColor: '#c2410c', recruiterName: 'Jane R.',
  recruiterMessage: 'Bonjour Claire, votre parcours nous intéresse.', job: { title: 'Business Analyst (Digital ESR)', location: 'Paris', contract: 'CDD' },
  privacyContact: 'dpo@cabinet.fr', initial: initialSubmission(snapshot),
};

describe('formulaire', () => {
  const html = renderToStaticMarkup(<LandingForm token="AbCdEfGhIjKlMnOpQrStUv" view={view} prefilled />);

  it('une lettre en parties nommées, dans l’ordre ; le bandeau d’information en pied', () => {
    const titles = ['Merci de votre intérêt', 'Vos coordonnées', 'Votre parcours', 'Validation', 'Information sur vos données'];
    const pos = titles.map((t) => html.indexOf(t));
    expect(pos.every((p, i) => p > -1 && (i === 0 || p > pos[i - 1]!))).toBe(true);
    expect(html).toContain('Vous avez échangé avec Jane au sujet du poste de Business Analyst (Digital ESR)');
    expect(html).toContain('cela prend deux minutes');
    expect(html).toContain('Bonjour Claire, votre parcours nous intéresse.');
    expect(html.indexOf('Ces informations sont exactes')).toBeLessThan(html.indexOf('Envoyer ma candidature'));
    expect(html.indexOf('Envoyer ma candidature')).toBeLessThan(html.indexOf('data-testid="privacy-banner"'));
    expect(html).toContain('Pré-rempli à partir de votre profil professionnel public');
    expect(html).toContain('supprimé à la clôture de ce recrutement');
    expect(html).toContain('responsable de traitement : Cabinet Conseil');
    expect(html).toContain('contact : dpo@cabinet.fr');
    expect(html).toContain('Je ne souhaite pas être recontacté·e');
  });

  it('parcours replié par défaut sur un résumé ; déplié, le même rendu que côté recruteur, « corriger » par ligne', () => {
    expect(html).toContain('1 expérience · 1 formation');
    expect(html).toContain('vérifier ✎');
    expect(html).not.toContain('data-section="career"');
    const open = renderToStaticMarkup(<ParcoursEditor value={{ workHistory: view.initial.workHistory, education: view.initial.education, about: view.initial.about }} onChange={() => {}} initiallyOpen />);
    for (const k of ['current', 'career', 'education', 'about']) expect(open).toContain(`data-section="${k}"`);
    expect(open).toContain('Business Analyst digital');
    expect(open.match(/corriger ✎/g)!.length).toBe(3);
    expect(open).not.toMatch(/<input[^>]*value="Business Analyst digital"/);
  });

  it('le CV est facultatif, et on dit ce qui le remplace', () => {
    expect(html).toContain('Si vous n’en joignez pas, le parcours ci-dessous servira de CV.');
  });

  it('email pré-rempli à confirmer, une case obligatoire, CV facultatif', () => {
    expect(html).toMatch(/value="claire.martin@exemple.fr"/);
    expect(html).toContain('à confirmer');
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toContain('Ces informations sont exactes et peuvent être utilisées pour ma candidature');
    expect(html).toContain('PDF ou DOCX, 10 Mo');
  });

  it('jamais affichés : disponibilité détectée, extrait, compétences, adresse du profil', () => {
    expect(html).not.toContain('écoute du marché');
    expect(html).not.toContain('du cadrage à la recette');
    expect(html).not.toContain('UML');
    expect(html).not.toContain('linkedin.com');
  });
});

describe('écrans terminaux et neutres', () => {
  it('envoyée : créneau avec le recruteur ; différée : « très prochainement »', () => {
    const sent = renderToStaticMarkup(<LandingOutcome outcome={{ kind: 'sent', firstName: 'Claire', recruiterName: 'Jane R.' }} organizationName="Cabinet" privacyContact="dpo@cabinet.fr" />);
    expect(sent).toContain('Merci Claire, votre candidature est bien reçue.');
    expect(sent).toContain('choisir un créneau d’entretien avec Jane R.');
    const received = renderToStaticMarkup(<LandingOutcome outcome={{ kind: 'received', firstName: 'Claire' }} organizationName="Cabinet" privacyContact={null} />);
    expect(received).toContain('très prochainement');
    expect(received).not.toContain('créneau');
  });

  it('opposition : ce qui est supprimé, ce qui reste', () => {
    const html = renderToStaticMarkup(<LandingOutcome outcome={{ kind: 'opposed' }} organizationName="Cabinet" privacyContact={null} />);
    expect(html).toContain('ne serez plus contacté·e pour les recrutements de Cabinet');
    expect(html).toContain('empreinte technique');
  });

  it('lien mort, offre close, recrutement suspendu : une phrase, jamais une erreur', () => {
    expect(renderToStaticMarkup(<LandingNotice kind="unavailable" />)).toContain('Cette invitation n’est plus disponible.');
    expect(renderToStaticMarkup(<LandingNotice kind="closed" />)).toContain('Cette offre n’est plus ouverte.');
    expect(renderToStaticMarkup(<LandingNotice kind="paused" />)).toContain('votre lien reste valable');
    for (const kind of ['unavailable', 'closed', 'paused', 'received'] as const) {
      expect(renderToStaticMarkup(<LandingNotice kind={kind} />)).not.toMatch(/404|erreur|error/i);
    }
  });
});
