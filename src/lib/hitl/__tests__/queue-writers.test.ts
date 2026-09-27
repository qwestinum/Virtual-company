/**
 * Garde STRUCTURELLE — la file de validation a deux écrivains, et deux seulement.
 *
 * `pending_validations` et `candidate_analyses` décrivent le même fait sans
 * rien qui les relie en base. La seule chose qui les tient est la discipline :
 * tout ce qui OUVRE une fiche passe par `enqueueValidationRow`, tout ce qui la
 * FERME passe par `settleValidationsForAnalysis` (ou par le classement sans
 * suite, qui a son propre chemin et ses propres claims).
 *
 * Cette discipline s'est déjà relâchée deux fois — une fois dans chaque sens,
 * et chaque fois personne ne l'a vu :
 *   · le dépôt de CV par le chat ouvrait sa fiche côté navigateur ;
 *   · le re-scoring faisait sortir un dossier de l'attente sans rien fermer.
 *
 * Aucun test de logique ne peut tenir cette promesse, parce que le défaut
 * consiste précisément à NE PAS appeler quelque chose. On lit donc les sources.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/** Les deux seules façons d'écrire le statut d'une fiche. */
const OPENERS = ['upsertPendingValidation'];
const CLOSERS = ['voidPendingValidation', 'patchPendingValidationDecision', 'reserveValidationSend'];

/**
 * Qui a le droit d'appeler les primitives d'écriture. Toute entrée ajoutée ici
 * est une DÉCISION : elle dit qu'un nouveau chemin écrit la file directement,
 * et qu'on l'assume.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/db/repos/pending-validations.ts': 'le repo lui-même',
  'src/lib/hitl/enqueue.ts': 'écrivain unique de l’OUVERTURE',
  'src/lib/hitl/settle.ts': 'écrivain unique de la CLÔTURE',
  'src/lib/candidatures/dismissal.ts':
    'classement sans suite — ferme sa fiche avec ses propres claims (void avant le classement)',
  'src/lib/hitl/send-validation.ts': 'décision humaine — réservation puis finalisation',
  'src/app/api/validations/[id]/route.ts': 'PATCH de décision, conditionné status=pending',
  'src/app/api/validations/[id]/reserve-send/route.ts': 'réservation d’envoi',
  'src/app/api/validations/[id]/send/route.ts': 'finalisation d’envoi',
  'src/app/api/validations/route.ts': 'POST de création — délègue la fusion',
  'scripts/rescore-analyses.ts': 'réparation — délègue aux deux écrivains',
};

/**
 * Fichiers du produit susceptibles d'écrire (hors tests). Parcours DIRECT du
 * disque : pas de shell, donc rien à échapper, et la garde ne dépend ni de
 * `git` ni de `grep` — elle doit tourner partout où tourne la suite.
 */
function sourceFiles(dir = '', out: string[] = []): string[] {
  for (const root of dir ? [dir] : ['src', 'scripts']) {
    for (const entry of readdirSync(join(process.cwd(), root), { withFileTypes: true })) {
      const rel = `${root}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        sourceFiles(rel, out);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(rel);
      }
    }
  }
  return out;
}

describe('la file de validation n’a que deux écrivains', () => {
  it('aucun chemin n’écrit le statut d’une fiche en dehors de la liste assumée', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file in ALLOWED) continue;
      const src = read(file);
      for (const primitive of [...OPENERS, ...CLOSERS]) {
        // On cherche l'APPEL, pas la mention : un commentaire qui nomme la
        // primitive ne doit pas faire échouer la garde.
        if (new RegExp(`\\b${primitive}\\s*\\(`).test(src)) {
          offenders.push(`${file} → ${primitive}()`);
        }
      }
    }
    expect(
      offenders,
      'Un nouveau chemin écrit la file directement. Passez par ' +
        '`enqueueValidationRow` (ouverture) ou `settleValidationsForAnalysis` ' +
        '(clôture), ou ajoutez-le à ALLOWED en disant pourquoi.',
    ).toEqual([]);
  });

  it('les deux écrivains restent branchés sur le même prédicat de cohérence', () => {
    // Deux prédicats — un par sens — re-fabriqueraient la divergence qu'on
    // cherche à voir. C'est exactement ce qui est arrivé au signal du 20/09.
    expect(read('src/lib/hitl/settle.ts')).toContain('checkValidationCoherence');
    expect(read('src/lib/notifications/business-signals.ts')).toContain('queueMismatch');
    expect(read('src/app/api/validations/route.ts')).toContain('checkValidationCoherence');
  });

  it('le re-scoring traite les DEUX sens', () => {
    // La branche entrante existait seule : c'est elle qui a laissé passer le
    // défaut de production du 21/08.
    const src = read('scripts/rescore-analyses.ts');
    expect(src).toContain('ensureValidationForAnalysis');
    expect(src).toContain('settleValidationsForAnalysisId');
  });

  it('l’identifiant d’une fiche est DÉRIVÉ, jamais inventé par l’appelant', () => {
    const src = read('src/app/api/validations/route.ts');
    expect(src).toContain('validationIdFor');
    // L'id reçu ne doit plus servir de clé d'écriture.
    expect(src).not.toContain('id: parsed.id,');
  });
});
