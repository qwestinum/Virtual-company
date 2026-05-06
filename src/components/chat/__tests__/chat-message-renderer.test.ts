import { describe, expect, it } from 'vitest';

import { parseMessageToBlocks } from '@/components/chat/chat-message-renderer';

describe('parseMessageToBlocks', () => {
  it('returns an empty array for empty or whitespace input', () => {
    expect(parseMessageToBlocks('')).toEqual([]);
    expect(parseMessageToBlocks('   \n  ')).toEqual([]);
  });

  it('returns a single paragraph when no bullets are present', () => {
    const blocks = parseMessageToBlocks('Bonjour, ravi de vous lire.');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Bonjour, ravi de vous lire.' },
    ]);
  });

  it('groups consecutive bullet lines into a single unordered list', () => {
    const text = [
      'Pour les missions, je propose :',
      '- Tenue de la comptabilité générale',
      '- Clôtures mensuelles',
      '- Déclarations fiscales',
      'Ça te convient ?',
    ].join('\n');
    const blocks = parseMessageToBlocks(text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      text: 'Pour les missions, je propose :',
    });
    expect(blocks[1]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        { text: 'Tenue de la comptabilité générale', level: 0 },
        { text: 'Clôtures mensuelles', level: 0 },
        { text: 'Déclarations fiscales', level: 0 },
      ],
    });
    expect(blocks[2]).toEqual({ kind: 'paragraph', text: 'Ça te convient ?' });
  });

  it('recognises numbered lists as ordered', () => {
    const blocks = parseMessageToBlocks('1. Premier\n2) Deuxième\n3. Troisième');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [
          { text: 'Premier', level: 0 },
          { text: 'Deuxième', level: 0 },
          { text: 'Troisième', level: 0 },
        ],
      },
    ]);
  });

  it('separates an ordered list from an unordered list', () => {
    const blocks = parseMessageToBlocks('- a\n- b\n1. one\n2. two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('accepts bullet variants - * •', () => {
    const blocks = parseMessageToBlocks('- a\n* b\n• c');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          { text: 'a', level: 0 },
          { text: 'b', level: 0 },
          { text: 'c', level: 0 },
        ],
      },
    ]);
  });

  it('captures indentation depth on nested bullets (2 spaces per level)', () => {
    const text = [
      '- Missions :',
      '  - Tenue comptable',
      '  - Clôtures',
      '- Compétences :',
      '    - SAP',
      '    - Excel',
    ].join('\n');
    const blocks = parseMessageToBlocks(text);
    expect(blocks).toHaveLength(1);
    const list = blocks[0] as { items: { text: string; level: number }[] };
    expect(list.items.map((it) => it.level)).toEqual([0, 1, 1, 0, 2, 2]);
    expect(list.items[1].text).toBe('Tenue comptable');
    expect(list.items[4].text).toBe('SAP');
  });

  it('treats one tab as two spaces of indent', () => {
    const blocks = parseMessageToBlocks('- top\n\t- nested');
    const list = blocks[0] as { items: { level: number }[] };
    expect(list.items[0].level).toBe(0);
    expect(list.items[1].level).toBe(1);
  });

  it('clamps indent levels above 4 (defensive)', () => {
    const blocks = parseMessageToBlocks(
      '- item\n              - very deep',
    );
    const list = blocks[0] as { items: { level: number }[] };
    expect(list.items[1].level).toBe(4);
  });

  it('preserves multi-line paragraphs as a single block', () => {
    const blocks = parseMessageToBlocks('ligne 1\nligne 2\nligne 3');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' });
    expect((blocks[0] as { text: string }).text).toContain('ligne 1');
    expect((blocks[0] as { text: string }).text).toContain('ligne 3');
  });
});
