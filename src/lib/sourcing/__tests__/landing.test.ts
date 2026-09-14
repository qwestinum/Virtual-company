import { describe, expect, it } from 'vitest';

import {
  buildStructuredCvText,
  initialSubmission,
  recruiterMessageForLanding,
  resolveLandingState,
  SubmissionSchema,
} from '@/lib/sourcing/landing';
import type { ExaSnapshot } from '@/types/sourcing';

const active = { status: 'active' as const };

describe('état de la page — jamais une erreur technique sur un lien reçu', () => {
  it.each([
    [{ moduleEnabled: false, approach: active, campaignStatus: 'active', profileAvailable: true }, 'unavailable'],
    [{ moduleEnabled: true, approach: null, campaignStatus: null, profileAvailable: false }, 'unavailable'],
    [{ moduleEnabled: true, approach: { status: 'revoked' as const }, campaignStatus: 'active', profileAvailable: true }, 'unavailable'],
    [{ moduleEnabled: true, approach: { status: 'submitted' as const }, campaignStatus: 'closed', profileAvailable: false }, 'received'],
    [{ moduleEnabled: true, approach: active, campaignStatus: 'closed', profileAvailable: false }, 'closed'],
    [{ moduleEnabled: true, approach: active, campaignStatus: 'paused', profileAvailable: true }, 'paused'],
    [{ moduleEnabled: true, approach: active, campaignStatus: 'active', profileAvailable: true }, 'form'],
  ])('%o ⇒ %s', (input, kind) => {
    expect(resolveLandingState(input).kind).toBe(kind);
  });

  it('profil purgé mais campagne active ⇒ formulaire vide', () => {
    expect(resolveLandingState({ moduleEnabled: true, approach: active, campaignStatus: 'active', profileAvailable: false })).toEqual({ kind: 'form', prefilled: false });
  });
});

describe('message rappelé en tête', () => {
  it('retire l’emplacement du lien, garde la phrase', () => {
    expect(recruiterMessageForLanding('Bonjour Claire, votre parcours nous intéresse : [lien] — Jane')).toBe('Bonjour Claire, votre parcours nous intéresse. — Jane');
    expect(recruiterMessageForLanding(null)).toBeNull();
  });
});

describe('saisie de la personne', () => {
  const base = { email: 'Claire.Martin@Exemple.fr', consent: true, fullName: 'Claire Martin', workHistory: [], education: [], about: null };

  it('la case est obligatoire, l’adresse est normalisée, le téléphone facultatif', () => {
    expect(SubmissionSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    const ok = SubmissionSchema.parse({ ...base, phone: '' });
    expect(ok.email).toBe('claire.martin@exemple.fr');
    expect(ok.phone).toBeUndefined();
    expect(SubmissionSchema.safeParse({ ...base, email: 'pas-une-adresse' }).success).toBe(false);
  });

  it('les valeurs initiales viennent du profil public, et seulement de lui', () => {
    const snap = { name: 'Claire Martin', location: 'Paris', skills: 'UML', contacts: { emails: ['claire.martin@exemple.fr'] }, workHistory: [{ title: 'BA', company: 'Banque X', location: 'Paris', from: '2024-05-01', to: null, description: 'Ateliers.' }], education: [], about: 'AMOA' } as unknown as ExaSnapshot;
    const init = initialSubmission(snap);
    expect(init).toMatchObject({ email: 'claire.martin@exemple.fr', fullName: 'Claire Martin', consent: false, about: 'AMOA' });
    expect(init.workHistory[0]).toEqual({ title: 'BA', company: 'Banque X', from: '2024-05-01', to: null, description: 'Ateliers.' });
    expect(init).toMatchObject({ location: 'Paris', skills: 'UML' });
    expect(initialSubmission(null)).toMatchObject({ email: '', fullName: '', workHistory: [] });
  });
});

describe('CV structuré', () => {
  it('rend ce qui a été confirmé, avec la mention d’origine, sans rien ajouter', () => {
    const text = buildStructuredCvText(
      SubmissionSchema.parse({
        email: 'claire.martin@exemple.fr', phone: '06 12 34 56 78', consent: true, fullName: 'Claire Martin', about: 'Business Analyst épargne salariale.',
        workHistory: [{ title: 'Business Analyst', company: 'Banque X', from: '2024-05-01', to: null }],
        education: [{ degree: 'Master SI', institution: 'Université W', from: '2014', to: '2016' }],
      }),
      '2026-09-14T10:00:00Z',
    );
    expect(text).toContain('Profil confirmé par le candidat le 14 septembre 2026 — source initiale : profil professionnel public.');
    expect(text).toContain('05/2024 – aujourd’hui  Business Analyst — Banque X');
    expect(text).toContain('2014 – 2016  Master SI — Université W');
    expect(text.split('\n')[0]).toBe('Claire Martin');
  });

  it('CV enrichi : localisation, description de chaque poste, compétences, langues, certifications', () => {
    const text = buildStructuredCvText(
      SubmissionSchema.parse({
        email: 'claire.martin@exemple.fr', consent: true, fullName: 'Claire Martin', about: null, location: 'Paris, France',
        workHistory: [{ title: 'Business Analyst', company: 'Banque X', from: '2024-05-01', to: null, description: 'Refonte des parcours.\nAteliers et recette.' }],
        education: [], skills: 'UML, SQL', languages: 'Anglais courant', certifications: 'PSPO I',
      }),
      '2026-09-14T10:00:00Z',
    );
    expect(text.split('\n')[1]).toBe('Paris, France');
    expect(text).toContain('Business Analyst — Banque X\n    Refonte des parcours.\n    Ateliers et recette.');
    expect(text).toContain('COMPÉTENCES\nUML, SQL');
    expect(text).toContain('LANGUES\nAnglais courant');
    expect(text).toContain('CERTIFICATIONS\nPSPO I');
  });
});

describe('ouverture du lien', () => {
  it('un robot d’aperçu n’ouvre pas le lien ; un navigateur, si', async () => {
    const { isLinkPreviewAgent } = await import('@/lib/sourcing/landing');
    expect(isLinkPreviewAgent('LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)')).toBe(true);
    expect(isLinkPreviewAgent('WhatsApp/2.23.20.0')).toBe(true);
    expect(isLinkPreviewAgent('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true);
    expect(isLinkPreviewAgent(null)).toBe(true);
    expect(isLinkPreviewAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isLinkPreviewAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36')).toBe(false);
  });
});
