/**
 * Frontière d'autonomie — le gardien.
 *
 * Le module doit rester extractible en paquet indépendant : il ne connaît ni
 * candidat, ni campagne, ni entretien, ni recruteur, et n'importe RIEN de
 * l'application hôte. La communication passe par les ports injectés et par les
 * événements.
 *
 * Une règle ESLint dit déjà cela (eslint.config.mjs). Ce test la DOUBLE
 * volontairement : il tourne avec la suite, donc la frontière tient même quand
 * personne ne lance le lint — et l'échec pointe le fichier fautif.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = join(__dirname, '..');

/**
 * Import de l'application hôte. On cherche l'alias `@/` sous n'importe quelle
 * forme (statique, dynamique, require) : dans ce module, aucune chaîne ne
 * commence légitimement par `@/`.
 */
const HOST_IMPORT = /['"]@\/[^'"]*['"]/g;

/**
 * Spécificateur de module plausible. Sert à écarter les faux positifs du scan
 * textuel : `Omit<T, 'from' | 'to'>` fait apparaître `from '…'` sans être un
 * import.
 */
const MODULE_SPECIFIER = /^(?:node:[\w/]+|@?[\w@][\w.\-/]*)$/;

/**
 * Vocabulaire métier qui n'a rien à faire ici — jusque dans les commentaires :
 * le module parle de ressources, de cibles, de liens, de réservations et
 * d'invités. Frontières de mot obligatoires, sinon l'anglais `candidate` (une
 * valeur candidate, notion générique) déclencherait à tort sur « candidat ».
 */
const HOST_VOCABULARY = [
  /\bcandidats?\b/i,
  /\bcampagnes?\b/i,
  /\bcampaigns?\b/i,
  /\brecruteurs?\b/i,
  /\brecruiters?\b/i,
  /\bbriefs?\b/i,
  /\bscoring\b/i,
  /\bvivier\b/i,
  /\bhitl\b/i,
];

function moduleFiles(dir: string = MODULE_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return moduleFiles(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

describe('frontière du module de réservation', () => {
  // Ce fichier ÉNONCE la frontière : il cite forcément les motifs qu'il
  // interdit. Il s'exclut donc de ses propres scans, jamais les autres.
  const files = moduleFiles().filter((file) => !file.endsWith('frontier.test.ts'));

  it('trouve bien les fichiers du module (garde anti-test-vide)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("n'importe rien de l'application hôte", () => {
    const offenders = files.flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(HOST_IMPORT) ?? [];
      return matches.map((match) => `${file.replace(MODULE_ROOT, '')} → ${match}`);
    });
    expect(offenders).toEqual([]);
  });

  it("n'importe que des bibliothèques externes connues", () => {
    // `react` est une dépendance GÉNÉRIQUE, pas un concept métier : le module
    // emporte ses propres écrans, sinon il ne serait réutilisable qu'à moitié.
    // La ligne rouge tient ailleurs : rien de `@/components`, aucun jeton de
    // design de l'hôte — les surfaces n'utilisent que leurs variables CSS.
    const allowed = new Set([
      'luxon',
      '@supabase/supabase-js',
      'react',
      'node:crypto',
      'node:fs',
      'node:path',
      'vitest',
    ]);
    const external = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from\s*['"]([^'"]+)['"]/g)]
        .map((match) => match[1] as string)
        .filter((specifier) => !specifier.startsWith('.'))
        .filter((specifier) => MODULE_SPECIFIER.test(specifier))
        .filter((specifier) => !allowed.has(specifier))
        .map((specifier) => `${file.replace(MODULE_ROOT, '')} → ${specifier}`),
    );
    expect(external).toEqual([]);
  });

  it('ne nomme aucun concept métier de l’hôte', () => {
    // Les autres tests sont exclus : ils peuvent décrire un scénario d'hôte.
    const sources = files.filter((file) => !file.includes('__tests__'));
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return HOST_VOCABULARY.filter((word) => word.test(text)).map(
        (word) => `${file.replace(MODULE_ROOT, '')} → ${word.source}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
