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
