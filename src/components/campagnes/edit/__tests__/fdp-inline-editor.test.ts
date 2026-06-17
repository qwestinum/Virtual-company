import { describe, expect, it } from 'vitest';

import {
  listValueToText,
  normalizeListInput,
  parseListInputRaw,
} from '@/components/campagnes/edit/FDPInlineEditor';

describe('FDPInlineEditor — saisie liste (missions / compétences)', () => {
  describe('parseListInputRaw — round-trip exact (curseur préservé)', () => {
    it("listValueToText(parseListInputRaw(t)) === t pour tout texte non vide", () => {
      for (const t of [
        'a',
        'a\nb',
        'a\n\nb', // ligne vide au milieu — ne doit PAS être supprimée pendant la frappe
        '  espaces conservés  ',
        'ligne\n', // saut de ligne final conservé
        'a\nb\nc\nd',
      ]) {
        expect(listValueToText(parseListInputRaw(t))).toBe(t);
      }
    });

    it('texte vide ou blanc → undefined', () => {
      expect(parseListInputRaw('')).toBeUndefined();
      expect(parseListInputRaw('   \n  ')).toBeUndefined();
    });
  });

  describe('normalizeListInput — blur : trim + suppression des vides', () => {
    it('trim chaque ligne et retire les lignes vides', () => {
      expect(normalizeListInput('  a  \n\n  b ')).toEqual(['a', 'b']);
      expect(normalizeListInput('a\n')).toEqual(['a']);
    });

    it('tout vide → undefined', () => {
      expect(normalizeListInput('\n  \n')).toBeUndefined();
    });
  });

  describe('listValueToText', () => {
    it('tableau → lignes jointes, chaîne → telle quelle, autre → vide', () => {
      expect(listValueToText(['a', 'b'])).toBe('a\nb');
      expect(listValueToText('libre')).toBe('libre');
      expect(listValueToText(undefined)).toBe('');
      expect(listValueToText(null)).toBe('');
    });
  });
});
