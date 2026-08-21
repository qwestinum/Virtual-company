import { describe, expect, it } from 'vitest';

import { parseSegments, renderAdBlocks } from '@/lib/jobboard/ad-render';

describe('parseSegments', () => {
  it('découpe l’emphase en segments (jamais du HTML injecté)', () => {
    expect(parseSegments('Contrat : **CDI** à Paris')).toEqual([
      { text: 'Contrat : ', strong: false },
      { text: 'CDI', strong: true },
      { text: ' à Paris', strong: false },
    ]);
  });

  it('laisse une paire orpheline en texte brut plutôt que de baver', () => {
    expect(parseSegments('Salaire **négociable')).toEqual([
      { text: 'Salaire **négociable', strong: false },
    ]);
  });
});

describe('renderAdBlocks', () => {
  const body = [
    'Rejoignez une équipe de 12 personnes.',
    'Le service se structure.',
    '',
    '## Missions',
    '- Tenue de la comptabilité générale',
    '- Clôtures mensuelles',
    '',
    '## Conditions',
    '- **CDI** — Paris',
    'Candidatez dès maintenant.',
  ].join('\n');

  it('regroupe les lignes contiguës en un seul paragraphe', () => {
    const blocks = renderAdBlocks(body);
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      segments: [
        {
          text: 'Rejoignez une équipe de 12 personnes. Le service se structure.',
          strong: false,
        },
      ],
    });
  });

  it('produit titres et listes', () => {
    const blocks = renderAdBlocks(body);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual([
      'paragraph',
      'heading',
      'list',
      'heading',
      'list',
      'paragraph',
    ]);
    const missions = blocks[2];
    expect(missions.kind === 'list' && missions.items).toHaveLength(2);
  });

  it('une phrase après une liste N’EST PAS avalée en dernière puce', () => {
    const blocks = renderAdBlocks(body);
    const last = blocks[blocks.length - 1];
    expect(last.kind).toBe('paragraph');
    expect(last.kind === 'paragraph' && last.segments[0].text).toBe(
      'Candidatez dès maintenant.',
    );
  });

  it('un corps vide ne produit aucun bloc (page qui ne casse pas)', () => {
    expect(renderAdBlocks('')).toEqual([]);
    expect(renderAdBlocks('\n\n  \n')).toEqual([]);
  });
});
