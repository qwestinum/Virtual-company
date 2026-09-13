/**
 * Ingestion — LE garde-fou le plus important du module : la section `## Social`
 * (publications et republications de TIERS) n'entre jamais, sous aucune forme.
 *
 * Testé dans les DEUX sens : une chaîne placée dans Social est absente de tout
 * ce qui est stocké ; la même chaîne placée dans About est présente. Sans le
 * second sens, un test qui ne stockerait rien du tout passerait aussi.
 */
import { describe, expect, it } from 'vitest';

import type { ExaResult } from '@/lib/sourcing/exa-schema';
import { ExaResultSchema } from '@/lib/sourcing/exa-schema';
import {
  keepAllowedSections,
  keepHighlightIfAllowed,
  projectExaResult,
  redactContacts,
} from '@/lib/sourcing/ingest';

const MARK = 'SENTINELLE-TIERS-7Q2';
const AVAILABILITY = 'Je suis actuellement à la recherche d’un nouveau poste';
const KEYWORD = 'SWIFT MT7xx';

function profile(about: string, social: string, extra: Partial<ExaResult> = {}): ExaResult {
  return ExaResultSchema.parse({
    id: 'https://exa.ai/library/person/x',
    url: 'https://www.linkedin.com/in/claire-test-4a1b2c',
    title: 'Claire Test',
    publishedDate: '2026-08-01T00:00:00.000Z',
    text: [
      '# Claire Test',
      'Consultante AMOA Trade Finance',
      'Paris',
      '',
      '## About',
      about,
      '',
      '## Experience',
      '### Consultante AMOA — Banque X',
      '',
      '## Social',
      social,
      '',
      '## Recommendations',
      'Jean Tiers : « une collègue formidable » ' + MARK,
    ].join('\n'),
    highlights: [social],
    entities: [
      {
        properties: {
          name: 'Claire Test',
          firstName: 'Claire',
          location: 'Paris, Île-de-France, France',
          workHistory: [
            { title: 'Consultante AMOA', location: 'Paris', dates: { from: '2021-10-01', to: null }, company: { name: 'Banque X' } },
          ],
          educationHistory: [{ degree: 'Master Finance', dates: { from: '2015', to: '2017' }, institution: { name: 'Université W' } }],
        },
      },
    ],
    ...extra,
  });
}

const stored = (r: ExaResult) => JSON.stringify(projectExaResult(r));

describe('section Social — coupée au point unique', () => {
  const socialPost = `- [2025-09-19 · Paul Tiers reposted this] ${AVAILABILITY}. ${KEYWORD}. ${MARK} — prière pour la guérison de ma sœur`;

  it('une disponibilité, un mot-clé de critère et une sentinelle placés dans Social n’entrent PAS', () => {
    const r = profile('Consultante AMOA depuis dix ans.', socialPost);
    const s = stored(r);
    expect(s).not.toContain(MARK);
    expect(s).not.toContain(AVAILABILITY);
    expect(s).not.toContain(KEYWORD);
    expect(s).not.toContain('Paul Tiers');
    expect(s).not.toContain('guérison');
    // L'extrait du moteur citait Social : il disparaît, il n'est pas « nettoyé ».
    expect(projectExaResult(r)!.highlight).toBeNull();
  });

  it('les mêmes chaînes placées dans About ENTRENT — le test mord, il ne se tait pas', () => {
    const r = profile(`${AVAILABILITY}. Spécialiste ${KEYWORD}.`, 'rien');
    const s = stored(r);
    expect(s).toContain(AVAILABILITY);
    expect(s).toContain(KEYWORD);
  });

  it('le texte que l’aval peut lire ne contient ni Social ni Recommendations', () => {
    const allowed = keepAllowedSections(profile('about', `${MARK} social`).text);
    expect(allowed.text).not.toContain(MARK);
    expect(allowed.text).not.toMatch(/## Social|## Recommendations/);
    expect(allowed.sections.about).toBe('about');
  });

  it('une section inconnue est coupée par défaut (liste blanche)', () => {
    const text = `# X\nTitre\n## About\nok\n## Volunteering\n${MARK}\n## Skills\nSQL`;
    const allowed = keepAllowedSections(text);
    expect(allowed.text).not.toContain(MARK);
    expect(allowed.sections.skills).toBe('SQL');
  });

  it('la ligne du nom n’est jamais lue comme titre de profil', () => {
    expect(keepAllowedSections('# Claire Test\nConsultante AMOA\nParis\n## About\nx').headline).toBe(
      'Consultante AMOA · Paris',
    );
  });
});

describe('extrait du moteur — fragments retrouvés dans le texte autorisé seulement', () => {
  const allowed = '## About\nBusiness Analyst sur les parcours digitaux de l’épargne salariale, du cadrage à la recette.';

  it('garde un fragment présent, jette un fragment absent', () => {
    const h = 'parcours digitaux de l’épargne salariale, du cadrage à la recette\n...\nreposted: je cherche un poste de chef de projet';
    expect(keepHighlightIfAllowed(h, allowed)).toBe('parcours digitaux de l’épargne salariale, du cadrage à la recette');
  });

  it('rien de retrouvé ⇒ aucun extrait', () => {
    expect(keepHighlightIfAllowed('une phrase venue d’ailleurs, assez longue pour compter', allowed)).toBeNull();
  });
});

describe('projection — liste blanche et coordonnées', () => {
  it('emails et téléphones du texte sont retirés en attendant la règle du titulaire', () => {
    const r = profile('Contactez-moi : claire.test@exemple.fr ou au 06 12 34 56 78.', 'x');
    const s = stored(r);
    expect(s).not.toContain('claire.test@exemple.fr');
    expect(s).not.toContain('06 12 34 56 78');
    expect(redactContacts('+33 6 12 34 56 78')).toBe('[numéro retiré]');
  });

  it('un champ que le moteur ajouterait demain (photo, contact) n’entre pas', () => {
    const raw = { ...(profile('a', 'b') as object), image: 'https://photo', contactInfo: { email: 'x@y.fr' } };
    const s = JSON.stringify(projectExaResult(ExaResultSchema.parse(raw)));
    expect(s).not.toContain('https://photo');
    expect(s).not.toContain('x@y.fr');
  });

  it('construit poste actuel, parcours daté, formation', () => {
    const p = projectExaResult(profile('a', 'b'))!;
    expect(p.url).toBe('https://www.linkedin.com/in/claire-test-4a1b2c');
    expect(p.current).toEqual({ title: 'Consultante AMOA', company: 'Banque X', since: '2021-10-01' });
    expect(p.education[0]).toEqual({ degree: 'Master Finance', institution: 'Université W', from: '2015', to: '2017' });
  });

  it('refuse ce qui n’est pas un profil ou n’a pas de nom', () => {
    expect(projectExaResult({ ...profile('a', 'b'), url: 'https://www.linkedin.com/company/x' })).toBeNull();
    expect(projectExaResult({ ...profile('a', 'b'), title: '', entities: [] })).toBeNull();
  });
});
