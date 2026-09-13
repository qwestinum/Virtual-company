/**
 * Page d'atterrissage — ce que la personne voit (spec §9.2, §14.5-14.6),
 * vérifié sur le HTML rendu.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LandingForm } from '@/components/sourcing-landing/LandingForm';
import { LandingOutcome } from '@/components/sourcing-landing/LandingOutcome';
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

  it('message rappelé, poste, bandeau d’information complet avec l’opposition', () => {
    expect(html).toContain('Bonjour Claire, votre parcours nous intéresse.');
    expect(html).toContain('Business Analyst (Digital ESR) · Paris · CDD');
    expect(html).toContain('Pré-rempli à partir de votre profil professionnel public');
    expect(html).toContain('supprimé à la clôture de ce recrutement');
    expect(html).toContain('responsable de traitement : Cabinet Conseil');
    expect(html).toContain('contact : dpo@cabinet.fr');
    expect(html).toContain('Je ne souhaite pas être recontacté·e');
  });

  it('récapitulatif en lecture seule, corrigeable ligne à ligne', () => {
    expect(html).toContain('Business Analyst digital — Banque X');
    expect(html).toContain('Master SI — Université W');
    expect(html.match(/corriger ✎/g)!.length).toBe(3);
    expect(html).not.toMatch(/<input[^>]*value="Business Analyst digital"/);
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
