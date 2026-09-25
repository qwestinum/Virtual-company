/**
 * Lot 3 — règles déterministes : disponibilité (§4.4, les 21 cas), email du
 * titulaire (§6), mentions (§5), message et jeton (§8), ordre « en recherche
 * d'abord » (§4.3).
 */
import { describe, expect, it } from 'vitest';

import { approachUrl, hashApproachToken, mintApproachToken } from '@/lib/sourcing/approach-token';
import { detectAvailability } from '@/lib/sourcing/availability';
import { extractHolderEmails } from '@/lib/sourcing/holder-email';
import { atomizeLabel, computeMentions } from '@/lib/sourcing/mentions';
import {
  checkMessage,
  EMAIL_INFORMATION_LINE,
  LINK_PLACEHOLDER,
  mailtoHref,
  renderMessage,
  restorePlaceholder,
  templateMessage,
  type MessageContext,
} from '@/lib/sourcing/message';
import { orderProfiles } from '@/lib/sourcing/ordering';
import type { ExaSnapshot, SourcingProfileView } from '@/types/sourcing';

describe('disponibilité — liste fermée (§4.4)', () => {
  const about = (text: string) => detectAvailability({ about: text });
  const positives = [
    'Je suis actuellement à la recherche d’un nouveau poste de chef de projet.',
    'En recherche active, disponible immédiatement.',
    'Ouverte à de nouvelles opportunités en AMOA.',
    'I am currently looking for a new role in data engineering.',
    'Open to new opportunities.',
    '#OpenToWork',
    'Je suis à la recherche d’une opportunité internationale (VIE ou contrat local).',
  ];
  const negatives = [
    'Let’s connect and explore opportunities to collaborate.',
    'Disponible en remote depuis Lyon.',
    'Always open to discussing technical challenges.',
    'Le jeu est disponible ici.',
  ];
  const falseFriends = [
    'Ingénieur de recherche au CNRS, spécialiste de la recherche et développement.',
    'Research engineer at INRIA.',
    'Je recherche des solutions innovantes pour mes clients.',
    'Constamment à la recherche de nouveaux défis pour enrichir mon savoir.',
    'Êtes-vous à la recherche d’un développeur expérimenté en React ?',
    'Si vous recherchez un collaborateur passionné, contactez-moi.',
    'Actuellement à la recherche d’un stage de fin d’études.',
    'Looking for a Node, Symfony, Laravel developer?',
    'Recherche de financements : crédits documentaires.',
  ];

  it.each(positives)('positif : %s', (t) => expect(about(t)).not.toBeNull());
  it.each(negatives)('négatif : %s', (t) => expect(about(t)).toBeNull());
  it.each(falseFriends)('faux ami : %s', (t) => expect(about(t)).toBeNull());

  it('« Disponible » en segment isolé du titre de profil, avec sa zone', () => {
    expect(detectAvailability({ headline: 'Lead Developer | React | Disponible' })).toEqual({ expression: 'Disponible', zone: 'headline' });
  });
});

describe('email du titulaire (§6.1)', () => {
  const base = { headline: null, firstName: 'Claire', lastName: 'Martin' };

  it('retenu : partie locale au nom, ou formule à la première personne', () => {
    expect(extractHolderEmails({ ...base, about: 'Joignable : claire.martin@exemple.fr' })).toEqual(['claire.martin@exemple.fr']);
    expect(extractHolderEmails({ ...base, about: 'Vous pouvez me contacter par e-mail : cm75@exemple.fr' })).toEqual(['cm75@exemple.fr']);
  });

  it('jeté : adresse fonctionnelle, contexte tiers, doute', () => {
    expect(extractHolderEmails({ ...base, about: 'Écrivez-moi : contact@cabinet.fr' })).toEqual([]);
    expect(extractHolderEmails({ ...base, about: 'Mon manager Paul : claire.martin.team@exemple.fr' })).toEqual([]);
    expect(extractHolderEmails({ ...base, about: 'jd92@exemple.fr' })).toEqual([]);
  });
});

describe('mentions (§5)', () => {
  const snap = {
    headline: 'Business Analyst', about: 'Parcours digitaux, UX research, excellence opérationnelle', skills: 'SQL, prince2',
    languages: null, certifications: null, workHistory: [], education: [],
  } as unknown as ExaSnapshot;

  it('atomise le libellé ; durée et libellé verbal ⇒ aucun terme', () => {
    expect(atomizeLabel('Solide culture de l’excellence opérationnelle')).toEqual(['excellence opérationnelle']);
    expect(atomizeLabel('Expérience confirmée de 10 à 15 ans')).toEqual([]);
    expect(atomizeLabel('Piloter le programme Data Protection')).toEqual([]);
  });

  it('trouve sans accent ni casse ; acronyme court sensible à la casse ; jamais de négatif', () => {
    const m = computeMentions(snap, [
      { id: 'a', level: 'critique', label: 'Parcours digitaux et sensibilité UX' },
      { id: 'b', level: 'tres_important', label: 'Maîtrise de SQL', keywords: ['SQL', 'Prince'] },
      { id: 'c', level: 'important', label: 'Anglais' },
      { id: 'd', level: 'critique', label: 'Expérience confirmée de 10 à 15 ans' },
    ]);
    expect(m.map((x) => x.criterionId)).toEqual(['a', 'b', 'd']);
    expect(m[0]!.found).toEqual(['Parcours digitaux', 'UX']);
    expect(m[1]!.found).toEqual(['SQL']); // « prince2 » ne répond pas à « Prince »
    expect(m[2]).toMatchObject({ terms: [], found: [] });
  });
});

describe('message d’approche (§8)', () => {
  const URL = 'https://orqa.exemple.fr/s/AbCdEfGhIjKlMnOpQrStUv';
  const ctx: MessageContext = {
    firstName: 'Claire', currentTitle: 'Business Analyst digital senior spécialisée épargne salariale et retraite', currentCompany: 'Banque X',
    highlights: [], jobTitle: 'Business Analyst (Digital ESR) – Expérimenté', location: 'Paris', recruiterFirstName: 'Jane', organisation: 'Cabinet Y',
  };

  it('le gabarit de note tient dans 300 caractères AVEC un vrai lien, et porte le lien une fois', () => {
    const t = templateMessage('connection_note', ctx);
    expect(checkMessage(t.body, 'connection_note', URL)).toEqual({ ok: true });
    expect(renderMessage(t.body, 'connection_note', URL).length).toBeLessThanOrEqual(300);
  });

  it('refuse : lien absent, lien en double, trop long, évaluation citée', () => {
    expect(checkMessage('Bonjour', 'inmail', URL).ok).toBe(false);
    expect(checkMessage(`${LINK_PLACEHOLDER} ${LINK_PLACEHOLDER}`, 'inmail', URL).ok).toBe(false);
    expect(checkMessage(`${'x'.repeat(260)} ${LINK_PLACEHOLDER}`, 'connection_note', URL).ok).toBe(false);
    expect(checkMessage(`Votre score de 82/100 ${LINK_PLACEHOLDER}`, 'inmail', URL).ok).toBe(false);
  });

  it('l’email reçoit la ligne d’information, ajoutée par le code', () => {
    expect(renderMessage(`Bonjour ${LINK_PLACEHOLDER}`, 'email', URL)).toContain(EMAIL_INFORMATION_LINE);
  });

  it('le texte stocké ne contient JAMAIS l’URL (elle porte le jeton en clair)', () => {
    const shown = renderMessage(`Bonjour Claire, ${LINK_PLACEHOLDER} — Jane`, 'email', URL);
    const stored = restorePlaceholder(shown.replace('Bonjour', 'Bonsoir'), URL)!;
    expect(stored).not.toContain(URL);
    expect(stored).not.toContain('AbCdEf');
    expect(stored).toBe(`Bonsoir Claire, ${LINK_PLACEHOLDER} — Jane`);
    expect(restorePlaceholder('lien retiré', URL)).toBeNull();
  });

  it('mailto trop long ⇒ l’URL ne porte que l’objet, le corps est copié', () => {
    expect(mailtoHref('a@b.fr', 'Objet', 'court').bodyInHref).toBe(true);
    const long = mailtoHref('a@b.fr', 'Objet', 'é'.repeat(1000));
    expect(long.bodyInHref).toBe(false);
    expect(long.href).not.toContain('body=');
  });

  it('jeton : 128 bits, empreinte SHA-256, lien /s/<jeton>', () => {
    const { token, tokenHash } = mintApproachToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApproachToken(token)).toBe(tokenHash);
    expect(approachUrl('https://x.fr/', token)).toBe(`https://x.fr/s/${token}`);
  });
});

describe('ordre « en recherche d’abord » (§4.3)', () => {
  const p = (rank: number, available: boolean) =>
    ({ id: String(rank), exaRank: rank, snapshot: { availability: available ? { expression: 'x', zone: 'about' } : null } }) as unknown as SourcingProfileView;

  it('regroupe sans réordonner à l’intérieur ; décoché ⇒ ordre du moteur pur', () => {
    const list = [p(3, false), p(1, false), p(4, true), p(2, true)];
    expect(orderProfiles(list, true).map((x) => x.exaRank)).toEqual([2, 4, 1, 3]);
    expect(orderProfiles(list, false).map((x) => x.exaRank)).toEqual([1, 2, 3, 4]);
  });

  it('les profils contactés passent en bas, l’ordre est conservé de chaque côté', () => {
    const c = (rank: number, available: boolean) => ({ ...p(rank, available), state: 'contacted' }) as unknown as SourcingProfileView;
    const list = [c(1, true), p(3, false), c(2, false), p(4, true), p(5, false)];
    expect(orderProfiles(list, false).map((x) => x.exaRank)).toEqual([3, 4, 5, 1, 2]);
    expect(orderProfiles(list, true).map((x) => x.exaRank)).toEqual([4, 3, 5, 1, 2]);
  });
});

describe('révocation d’une approche (25/09/2026)', () => {
  it('une approche confirmée (updated_at ≠ created_at) n’est jamais « intacte »', async () => {
    const { isUntouchedApproach } = await import('@/lib/db/repos/sourcing-approaches');
    const t = '2026-09-24T12:53:44.048876+00:00';
    expect(isUntouchedApproach({ created_at: t, updated_at: t })).toBe(true);
    // Confirmée dans la même milliseconde : la microseconde suffit à le voir.
    expect(isUntouchedApproach({ created_at: t, updated_at: '2026-09-24T12:53:44.048877+00:00' })).toBe(false);
    expect(isUntouchedApproach({ created_at: t, updated_at: '2026-09-24T12:55:06.573814+00:00' })).toBe(false);
  });
});
