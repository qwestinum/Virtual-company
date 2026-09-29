/**
 * L'import ALIMENTE le vivier, et rien d'autre — garde STRUCTURELLE.
 *
 * Aucun mail, aucune analyse de campagne, aucune présélection. Aucun test de
 * logique ne tient cette promesse pour un chemin qui n'appelle rien : on
 * vérifie que ni le script ni ses modules ne peuvent, par construction,
 * atteindre un émetteur, l'analyse de candidature ou la présélection.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FORBIDDEN = [
  '@/lib/email',
  'sendEmail',
  '@/lib/imap',
  '@/lib/hitl',
  'dispatchCandidateOutreach',
  'analyzeCVApplication',
  '@/lib/scoring',
  '@/lib/vivier/preselection',
  '@/lib/vivier/ingest-application',
  'feedVivierFromApplication',
  'replacePreselection',
  '@/lib/vivier/invite',
];

function importsOf(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8')
    .split('\n')
    .filter((l) => /^\s*import\b|from '@\/|import\('@\//u.test(l))
    .join('\n');
}

const MODULE_DIR = 'src/lib/vivier/import';
const FILES = [
  'scripts/vivier-import.ts',
  ...readdirSync(join(process.cwd(), MODULE_DIR))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${MODULE_DIR}/${f}`),
];

describe('l’import n’envoie rien, n’analyse rien, ne présélectionne rien', () => {
  it.each(FILES)('%s n’atteint aucun émetteur ni aucune décision', (relPath) => {
    const imports = importsOf(relPath);
    for (const needle of FORBIDDEN) expect(imports).not.toContain(needle);
  });

  it('la garde voit bien les imports différés du script (sinon elle serait décorative)', () => {
    expect(importsOf('scripts/vivier-import.ts')).toContain("import('@/lib/vivier/indexing')");
  });

  it('l’indexation réutilisée n’atteint elle-même aucun émetteur ni aucune présélection', () => {
    const imports = importsOf('src/lib/vivier/indexing.ts');
    for (const needle of FORBIDDEN) expect(imports).not.toContain(needle);
  });

  it('l’import n’écrit que par INSERTION (jamais la mise à jour d’un dossier existant)', () => {
    // Code seulement : un commentaire peut NOMMER ce qu'on s'interdit.
    const all = FILES.map((f) => readFileSync(join(process.cwd(), f), 'utf8'))
      .join('\n')
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/u.test(l))
      .join('\n');
    expect(all).not.toContain('upsertVivierCandidate');
    expect(all).not.toContain('updateVivierCandidateCV');
  });
});
