import { describe, expect, it } from 'vitest';

import { sanitizePostgrestSearch } from '@/lib/db/sanitize-search';

describe('sanitizePostgrestSearch', () => {
  it('laisse passer une saisie simple (trim)', () => {
    expect(sanitizePostgrestSearch('  Jean Dupont ')).toBe('Jean Dupont');
  });

  it('neutralise les séparateurs et jokers PostgREST', () => {
    expect(sanitizePostgrestSearch('a,b(c)d%e*f')).toBe('a b c d e f');
  });

  it('neutralise antislash et guillemets (durcissement injection)', () => {
    expect(sanitizePostgrestSearch(`name\\'-- "x"`)).toBe('name  --  x');
    expect(sanitizePostgrestSearch(`o'brien`)).toBe('o brien');
    expect(sanitizePostgrestSearch('back\\slash')).toBe('back slash');
  });

  it('chaîne vide / espaces ⇒ chaîne vide', () => {
    expect(sanitizePostgrestSearch('   ')).toBe('');
    expect(sanitizePostgrestSearch('')).toBe('');
  });
});
