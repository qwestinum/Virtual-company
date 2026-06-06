import { describe, expect, it } from 'vitest';

import {
  extractEmailsFromText,
  resolveCandidateEmail,
} from '@/lib/agents/candidate-email';

describe('extractEmailsFromText', () => {
  it('extrait dans l’ordre et déduplique (insensible à la casse)', () => {
    const txt =
      'Contact: Imad.Belfaqir@qwestinum.fr | secours: imad.belfaqir@QWESTINUM.fr';
    expect(extractEmailsFromText(txt)).toEqual(['Imad.Belfaqir@qwestinum.fr']);
  });

  it('nettoie la ponctuation finale', () => {
    expect(extractEmailsFromText('mail: a@b.fr, puis autre')).toEqual([
      'a@b.fr',
    ]);
  });

  it('renvoie [] si aucun email', () => {
    expect(extractEmailsFromText('aucune adresse ici')).toEqual([]);
    expect(extractEmailsFromText('')).toEqual([]);
  });
});

describe('resolveCandidateEmail', () => {
  const cv =
    'Imad BELFAQIR — Test Manager\nimad.belfaqir@qwestinum.fr | 06 00 00 00 00';

  it('verified : l’email du LLM figure dans le CV → retenu (casse du CV)', () => {
    const r = resolveCandidateEmail(cv, 'IMAD.BELFAQIR@qwestinum.fr');
    expect(r.status).toBe('verified');
    expect(r.email).toBe('imad.belfaqir@qwestinum.fr');
  });

  it('corrected : l’email du LLM est absent du CV → 1ʳᵉ adresse du CV', () => {
    // Le LLM renvoie l'expéditeur de l'enveloppe, pas l'email du CV.
    const r = resolveCandidateEmail(cv, 'belfaqir_imad@yahoo.fr');
    expect(r.status).toBe('corrected');
    expect(r.email).toBe('imad.belfaqir@qwestinum.fr');
  });

  it('corrected : LLM null mais CV a un email → on prend celui du CV', () => {
    const r = resolveCandidateEmail(cv, null);
    expect(r.status).toBe('corrected');
    expect(r.email).toBe('imad.belfaqir@qwestinum.fr');
  });

  it('absent : aucun email dans le CV → null, on n’enverra rien', () => {
    const r = resolveCandidateEmail('CV sans adresse email', 'x@y.fr');
    expect(r.status).toBe('absent');
    expect(r.email).toBeNull();
  });

  it('déterministe : même entrée ⇒ même sortie', () => {
    const a = resolveCandidateEmail(cv, 'autre@ailleurs.com');
    const b = resolveCandidateEmail(cv, 'autre@ailleurs.com');
    expect(a).toEqual(b);
  });

  it('multi-emails : prend la 1ʳᵉ du document si le LLM n’en cite aucune valable', () => {
    const multi = 'perso@gmail.com puis pro@boite.fr';
    const r = resolveCandidateEmail(multi, 'inconnu@nulle.part');
    expect(r.email).toBe('perso@gmail.com');
    expect(r.found).toEqual(['perso@gmail.com', 'pro@boite.fr']);
  });
});

describe('resolveCandidateEmail — CV mal formés (durcissement 6c)', () => {
  it('email collé à de la ponctuation / entre parenthèses', () => {
    const r = resolveCandidateEmail('Coordonnées (jean.dupont@example.com).', null);
    expect(r.email).toBe('jean.dupont@example.com');
  });

  it('email avec tag +cv, sous-domaine et TLD multi-niveaux', () => {
    const cv = 'Marie\nmarie+cv@mail.sub.example.co.uk\nParis';
    const r = resolveCandidateEmail(cv, null);
    expect(r.email).toBe('marie+cv@mail.sub.example.co.uk');
  });

  it('ignore les faux positifs (pas de local part, pas de TLD) et prend le vrai email', () => {
    const cv = 'arobase @nope.com, hôte jean@localhost, vrai: r.real@boite.fr';
    const r = resolveCandidateEmail(cv, null);
    expect(r.found).toEqual(['r.real@boite.fr']);
    expect(r.email).toBe('r.real@boite.fr');
  });

  it('email collé sans espace dans une ligne dense, ponctuation finale nettoyée', () => {
    const cv = 'Email:jean@x.com;Tel:0600000000.';
    const r = resolveCandidateEmail(cv, null);
    expect(r.email).toBe('jean@x.com');
  });

  it('préserve la casse de la 1ʳᵉ occurrence (CV en MAJUSCULES)', () => {
    const cv = 'CV\nJEAN.DUPONT@MAIL.COM';
    const r = resolveCandidateEmail(cv, 'jean.dupont@mail.com');
    // L'email LLM (minuscules) figure dans le CV (insensible casse) → verified,
    // mais on retient la casse RÉELLE du CV.
    expect(r.status).toBe('verified');
    expect(r.email).toBe('JEAN.DUPONT@MAIL.COM');
  });

  it('LLM renvoie un email malformé (sans @) → corrected vers le CV', () => {
    const r = resolveCandidateEmail('Contact : a.b@boite.fr', 'pasunemail');
    expect(r.status).toBe('corrected');
    expect(r.email).toBe('a.b@boite.fr');
  });

  it('CV vide ou non textuel → absent, jamais d’envoi', () => {
    expect(resolveCandidateEmail('', 'x@y.fr').status).toBe('absent');
    expect(resolveCandidateEmail('   \n\t  ', null).email).toBeNull();
  });
});
