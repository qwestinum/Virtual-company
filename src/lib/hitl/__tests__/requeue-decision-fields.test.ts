/**
 * Garde STRUCTURELLE — une remise en file, un réessai ou un rejeu ne DÉCIDE
 * jamais (27/09/2026).
 *
 * Défaut attrapé par la régression S4 : une remise en file réécrivait la
 * décision d'une fiche encore `pending`. Le recruteur venait de choisir
 * « accepter », la fiche repassait à « refuser » entre son clic et la
 * réservation d'envoi ; l'invitation partait (le mail suit l'écran) pendant
 * que la finalisation enregistrait un refus et révoquait le lien de
 * réservation.
 *
 * Aucun test de logique ne tient cette promesse sur les chemins de DEMAIN :
 * le défaut consiste à ce qu'un nouveau chemin importe un accès en écriture
 * qu'il n'aurait jamais dû toucher. On lit donc les sources — comme pour les
 * émetteurs de mail (`requeue-no-send.test.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/** Les commentaires ne comptent pas : on cherche l'usage, pas la mention. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Accès en ÉCRITURE aux champs de décision — ceux de la fiche (décision,
 * confirmation, auteur, statut) et la décision humaine portée par l'analyse.
 */
const DECISION_WRITERS = [
  'patchPendingValidationDecision',
  'patchPendingValidation',
  'reserveValidationSend',
  'updateCandidateAnalysisDecision',
];

/**
 * Chemins de remise en file / réessai / rejeu. DÉCOUVERTS par leur nom, pour
 * qu'un chemin ajouté demain soit couvert sans qu'on pense à l'inscrire ici…
 */
const NAME_PATTERN = /(requeue|re-?queue|retr(y|ies)|replay|enqueue|rescore)/i;

/** …plus ceux qui remettent en file sans le dire dans leur nom. */
const EXTRA = [
  'src/lib/imap/outreach.ts', // mise en file du gate (IMAP, chat, sourcing)
  'src/app/api/cv-analyzer/route.ts', // filet serveur du dépôt de CV
  'src/lib/hitl/validation-from-analysis.ts', // fiche reconstruite d'une analyse
  'src/app/api/validations/route.ts', // POST de (re)mise en file
];

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

const SCOPE = [
  ...new Set([...sourceFiles().filter((f) => NAME_PATTERN.test(f)), ...EXTRA]),
].sort();

describe('une remise en file ne décide jamais', () => {
  it('le périmètre découvert couvre bien les chemins connus', () => {
    // Sans ce contrôle, un renommage viderait le périmètre et la garde
    // deviendrait verte pour de mauvaises raisons.
    for (const known of [
      'src/lib/hitl/enqueue.ts',
      'src/lib/hitl/enqueue-merge.ts',
      'src/lib/hitl/requeue.ts',
      'src/app/api/validations/requeue/route.ts',
      'src/lib/imap/poll-retry.ts',
      'src/lib/imap/unmatched-replay.ts',
      'src/app/api/imap/unmatched/[id]/replay/route.ts',
      'scripts/rescore-analyses.ts',
    ]) {
      expect(SCOPE).toContain(known);
    }
  });

  it('aucun chemin du périmètre n’importe un accès en écriture aux champs de décision', () => {
    const offenders: string[] = [];
    for (const file of SCOPE) {
      const src = code(read(file));
      for (const writer of DECISION_WRITERS) {
        if (new RegExp(`\\b${writer}\\b`).test(src)) offenders.push(`${file} → ${writer}`);
      }
      // Écriture brute de la file, hors du dépôt : même interdit.
      if (/from\(\s*['"]pending_validations['"]\s*\)[\s\S]{0,200}?\.(update|upsert)\(/.test(src)) {
        offenders.push(`${file} → écriture directe de pending_validations`);
      }
    }
    expect(
      offenders,
      'Une remise en file / un réessai / un rejeu touche aux champs de décision. ' +
        'Il passe par `enqueueValidationRow`, qui ne rafraîchit que ' +
        '`ENQUEUE_REFRESHABLE` — la décision appartient à l’humain.',
    ).toEqual([]);
  });

  it('la mise à jour d’une fiche existante n’écrit que les champs rafraîchissables', () => {
    const src = code(read('src/lib/db/repos/pending-validations.ts'));
    const start = src.indexOf('export async function upsertPendingValidation');
    const end = src.indexOf('export ', start + 10);
    const body = src.slice(start, end);
    expect(body).toContain('.update(enqueueRefreshRow(');
    // L'ancienne forme réécrivait la ligne ENTIÈRE, décision comprise.
    expect(body).not.toMatch(/\.update\(\s*row\s*\)/);
  });
});
