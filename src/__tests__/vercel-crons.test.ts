/**
 * `vercel.json` — chaque cron déclaré pointe une route qui EXISTE, et qui porte
 * la garde par projet (`CRON_ENABLED`) et l'authentification fail-closed.
 *
 * Le fichier est commun à tous les déploiements : un chemin mal recopié ferait
 * appeler une route absente à chaque minute, sur chaque projet, sans que
 * personne ne le voie ; une route sans garde relèverait la base de la dev.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type VercelConfig = { crons?: { path: string; schedule: string }[] };

const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as VercelConfig;
const crons = config.crons ?? [];

describe('vercel.json — crons', () => {
  it('ne contient QUE des crons', () => {
    expect(Object.keys(config)).toEqual(['crons']);
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons.map((c) => [c.path, c.schedule]))('%s (%s) : la route existe, gardée et authentifiée', (path) => {
    expect(path.startsWith('/api/cron/')).toBe(true);
    const file = join(process.cwd(), 'src/app', path, 'route.ts');
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/cronDisabledResponse\(\)/);
    expect(src).toMatch(/rejectUnauthorizedCron\(request\)/);
    // La garde AVANT l'authentification (cf. cron-enabled.ts).
    expect(src.indexOf('cronDisabledResponse()')).toBeLessThan(src.indexOf('rejectUnauthorizedCron(request)'));
  });
});
