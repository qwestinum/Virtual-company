import { describe, expect, it } from 'vitest';

import {
  invitationTextToHtml,
  renderVivierInvitation,
} from '@/lib/vivier/invitation-template';
import { DEFAULT_VIVIER_INVITATION_TEMPLATE } from '@/types/vivier-settings';

const vars = {
  prenom: 'Jane',
  jobTitle: 'Développeuse backend',
  campaignName: 'CAMP-42 Backend',
  reference: 'CAMP-0042',
  receptionAddress: 'candidatures@acme.com',
  organisation: 'ACME',
  rgpdContact: 'rgpd@acme.com',
};

describe('renderVivierInvitation', () => {
  it('résout toutes les variables du template par défaut', () => {
    const text = renderVivierInvitation(DEFAULT_VIVIER_INVITATION_TEMPLATE, vars);
    expect(text).toContain('Bonjour Jane,');
    expect(text).toContain('Développeuse backend');
    expect(text).toContain('candidatures@acme.com');
    expect(text).toContain('« CAMP-0042 »'); // référence (ID) à quoter en objet
    expect(text).toContain('ACME');
    // Aucun placeholder résiduel.
    expect(text).not.toMatch(/\[(prénom|intitulé du poste|référence|nom de la campagne|adresse de réception|Organisation)\]/);
  });

  it('insiste sur la référence en objet comme indispensable au rattachement', () => {
    const text = renderVivierInvitation(DEFAULT_VIVIER_INVITATION_TEMPLATE, vars);
    expect(text.toLowerCase()).toContain('objet');
    expect(text.toLowerCase()).toMatch(/indispensable|impérativement/);
    expect(text).toContain('CAMP-0042');
  });

  it('substitue [référence] indépendamment de [nom de la campagne]', () => {
    const text = renderVivierInvitation(
      'Réf [référence] — campagne [nom de la campagne]',
      vars,
    );
    expect(text).toContain('Réf CAMP-0042 — campagne CAMP-42 Backend');
  });

  it('appose la mention RGPD (conservation + suppression à [contact])', () => {
    const text = renderVivierInvitation(DEFAULT_VIVIER_INVITATION_TEMPLATE, vars);
    expect(text).toContain('vivier de candidatures');
    expect(text).toContain('suppression à tout moment');
    expect(text).toContain('rgpd@acme.com');
  });

  it('est une invitation à CANDIDATER, jamais à un entretien', () => {
    const text = renderVivierInvitation(DEFAULT_VIVIER_INVITATION_TEMPLATE, vars);
    expect(text.toLowerCase()).toContain('candidature');
    expect(text.toLowerCase()).not.toContain('entretien');
  });
});

describe('invitationTextToHtml', () => {
  it('enveloppe en paragraphes et échappe le HTML', () => {
    const html = invitationTextToHtml('Bonjour <b>Jane</b>\nLigne 2\n\nParagraphe 2');
    expect(html).toContain('<p>Bonjour &lt;b&gt;Jane&lt;/b&gt;<br/>Ligne 2</p>');
    expect(html).toContain('<p>Paragraphe 2</p>');
  });
});
