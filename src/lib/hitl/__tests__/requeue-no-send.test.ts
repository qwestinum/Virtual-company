/**
 * « Aucun envoi, jamais » — garde STRUCTURELLE sur la re-mise en file.
 *
 * Mettre en file, c'est demander un clic humain ; c'est exactement le
 * contraire d'envoyer. La conformité RGPD du 18/08/2026 tient sur le fait
 * qu'aucun refus ne part sans ce clic. Aucun test de logique ne peut tenir
 * cette promesse pour un chemin qui n'appelle rien : on vérifie donc que le
 * module ne peut pas, par construction, atteindre un émetteur.
 *
 * Même garde que `decision-correction.ts`, pour la même raison.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FORBIDDEN = [
  '@/lib/email/client',
  '@/lib/hitl/send-validation',
  '@/lib/imap/outreach',
  'emitCampaignBookingLink',
  'sendEmail',
  'dispatchCandidateOutreach',
  'composeAndSendCandidateMail',
];

function importsOf(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8')
    .split('\n')
    .filter((l) => l.trimStart().startsWith('import') || l.includes("from '@/"))
    .join('\n');
}

describe('aucun envoi, jamais', () => {
  it.each([
    'src/lib/hitl/requeue.ts',
    'src/lib/hitl/enqueue.ts',
    'src/lib/hitl/validation-from-analysis.ts',
    'src/app/api/validations/requeue/route.ts',
  ])('%s n’importe AUCUN émetteur', (relPath) => {
    const imports = importsOf(relPath);
    for (const needle of FORBIDDEN) {
      expect(imports).not.toContain(needle);
    }
  });

  it('le constructeur de ligne reste PUR (aucun accès base ni réseau)', () => {
    // Il est appelé par un script (re-scoring) comme par une route : une
    // lecture cachée le rendrait intestable et non rejouable.
    const imports = importsOf('src/lib/hitl/validation-from-analysis.ts');
    for (const needle of ['supabase', '@/lib/db/repos', 'fetch(']) {
      expect(imports).not.toContain(needle);
    }
  });
});
