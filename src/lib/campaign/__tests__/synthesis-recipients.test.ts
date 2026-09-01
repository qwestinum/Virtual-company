import { describe, expect, it } from 'vitest';

import {
  mergeSynthesisRecipients,
  splitSynthesisAudience,
  splitSynthesisRecipients,
} from '@/lib/campaign/synthesis-recipients';

describe('mergeSynthesisRecipients — référent + configurées, dédup', () => {
  it('référent en tête, puis les configurées', () => {
    expect(
      mergeSynthesisRecipients('jane@corp.fr', ['drh@corp.fr', 'dir@corp.fr']),
    ).toEqual(['jane@corp.fr', 'drh@corp.fr', 'dir@corp.fr']);
  });

  it('ÉVITE le double envoi si le référent est déjà configuré (casse ignorée)', () => {
    expect(
      mergeSynthesisRecipients('Jane@Corp.fr', ['drh@corp.fr', 'jane@corp.fr']),
    ).toEqual(['Jane@Corp.fr', 'drh@corp.fr']);
  });

  it('sans référent → configurées seules (comportement historique)', () => {
    expect(mergeSynthesisRecipients(null, ['drh@corp.fr'])).toEqual(['drh@corp.fr']);
  });

  it('doublons internes des configurées aussi dédupliqués ; vides ignorés', () => {
    expect(
      mergeSynthesisRecipients(null, ['drh@corp.fr', ' DRH@corp.fr ', '', 'dir@corp.fr']),
    ).toEqual(['drh@corp.fr', 'dir@corp.fr']);
  });

  it('ni référent ni configurée → vide (no_recipient chez l’appelant)', () => {
    expect(mergeSynthesisRecipients(null, [])).toEqual([]);
  });
});

describe('adresses NON expédiables — écartées, jamais transmises', () => {
  it('écarte le placeholder du runbook laissé en base', () => {
    // Cas réel : le seed a laissé `ton-email-de-connexion` comme adresse de
    // l'administrateur, référent de trois campagnes. Transmise telle quelle,
    // elle faisait rejeter le message ENTIER par le fournisseur — donc aucun
    // briefing livré, pour personne, en silence.
    const { recipients, rejected } = splitSynthesisRecipients(
      'ton-email-de-connexion',
      ['drh@corp.fr'],
    );
    expect(recipients).toEqual(['drh@corp.fr']);
    expect(rejected).toEqual(['ton-email-de-connexion']);
  });

  it('l’envoi survit : les destinataires valides restent servis', () => {
    expect(
      mergeSynthesisRecipients('pas-une-adresse', ['drh@corp.fr', 'dir@corp.fr']),
    ).toEqual(['drh@corp.fr', 'dir@corp.fr']);
  });

  it('écarte aussi une adresse sans domaine complet', () => {
    const { rejected } = splitSynthesisRecipients(null, [
      'jane@localhost',
      'jane@',
      '@corp.fr',
      'jane doe@corp.fr',
    ]);
    expect(rejected).toEqual([
      'jane@localhost',
      'jane@',
      '@corp.fr',
      'jane doe@corp.fr',
    ]);
  });

  it('accepte les formes courantes (sous-domaine, +, tirets)', () => {
    const { recipients, rejected } = splitSynthesisRecipients(null, [
      'jane.doe+rh@mail.corp.fr',
      'j-d@corp-rh.fr',
    ]);
    expect(rejected).toEqual([]);
    expect(recipients).toHaveLength(2);
  });

  it('la dédup passe AVANT le tri : une invalide en double n’est comptée qu’une fois', () => {
    const { rejected } = splitSynthesisRecipients('BIDON', ['bidon', 'drh@corp.fr']);
    expect(rejected).toEqual(['BIDON']);
  });
});

describe('splitSynthesisAudience — le référent en principal, la synthèse en copie', () => {
  it('le référent est SEUL destinataire principal, les configurées suivent en copie', () => {
    expect(
      splitSynthesisAudience('jane@corp.fr', ['drh@corp.fr', 'dir@corp.fr']),
    ).toEqual({
      to: ['jane@corp.fr'],
      cc: ['drh@corp.fr', 'dir@corp.fr'],
      rejected: [],
    });
  });

  it('référent déjà configuré : principal une fois, jamais aussi en copie', () => {
    // Sinon le fournisseur lui livre DEUX exemplaires du même briefing.
    expect(
      splitSynthesisAudience('Jane@Corp.fr', ['jane@corp.fr', 'drh@corp.fr']),
    ).toEqual({ to: ['Jane@Corp.fr'], cc: ['drh@corp.fr'], rejected: [] });
  });

  it('sans référent : la 1re adresse de synthèse tient la place, le reste en copie', () => {
    // Un message sans destinataire principal n'est pas expédiable — on ne
    // troque pas la convention contre un envoi qui n'arrive à personne.
    expect(splitSynthesisAudience(null, ['drh@corp.fr', 'dir@corp.fr'])).toEqual({
      to: ['drh@corp.fr'],
      cc: ['dir@corp.fr'],
      rejected: [],
    });
  });

  it('référent non expédiable : il ne prend PAS la place du principal', () => {
    expect(
      splitSynthesisAudience('ton-email-de-connexion', ['drh@corp.fr']),
    ).toEqual({
      to: ['drh@corp.fr'],
      cc: [],
      rejected: ['ton-email-de-connexion'],
    });
  });

  it('référent seul : personne en copie (aucun en-tête Cc)', () => {
    expect(splitSynthesisAudience('jane@corp.fr', [])).toEqual({
      to: ['jane@corp.fr'],
      cc: [],
      rejected: [],
    });
  });

  it('aucune adresse : `to` vide ⇒ no_recipient, JAMAIS un message en copie seule', () => {
    expect(splitSynthesisAudience(null, [])).toEqual({
      to: [],
      cc: [],
      rejected: [],
    });
  });
});
