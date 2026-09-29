import { describe, expect, it } from 'vitest';

import { parseImportArgs } from '../options';

describe('options de vivier:import', () => {
  it('refuse de tourner sans --env', () => {
    expect(parseImportArgs(['--dir=cv'])).toMatchObject({ error: expect.stringContaining('--env') });
  });

  it('refuse d’écrire sans --confirm-project', () => {
    expect(parseImportArgs(['--env=.env.local', '--dir=cv', '--execute'])).toMatchObject({
      error: expect.stringContaining('--confirm-project'),
    });
  });

  it('une confirmation sans --execute est une erreur, pas une écriture muette', () => {
    expect(parseImportArgs(['--env=e', '--dir=cv', '--confirm-project=abc'])).toHaveProperty('error');
  });

  it('exige une source', () => {
    expect(parseImportArgs(['--env=e'])).toMatchObject({ error: expect.stringContaining('source') });
  });

  it('constat par défaut ; plusieurs --zip ; dossier et zip cumulables', () => {
    const o = parseImportArgs(['--env=e', '--dir=cv', '--zip=a.zip', '--zip=b.zip', '--dates=d.csv']);
    expect(o).toMatchObject({ execute: false, dir: 'cv', zips: ['a.zip', 'b.zip'], datesPath: 'd.csv' });
  });

  it('rejette une option inconnue ou vide', () => {
    expect(parseImportArgs(['--env=e', '--dir=cv', '--dry-run'])).toHaveProperty('error');
    expect(parseImportArgs(['--env=e', '--dir='])).toHaveProperty('error');
    expect(parseImportArgs(['--env=e', '--dir=cv', '--concurrency=0'])).toHaveProperty('error');
  });
});
