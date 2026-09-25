/**
 * « Dry-run pur » — garde STRUCTURELLE du script de comparaison de modèles.
 *
 * Le script rejoue des CV de personnes réelles par le chemin d'analyse du
 * produit. Aucun test de logique ne peut prouver qu'il n'ÉCRIT pas et
 * n'ENVOIE pas : il faudrait qu'il essaie. On vérifie donc qu'il ne PEUT pas
 * — sur tout le graphe d'imports atteignable, pas seulement ses imports
 * directs (un module d'analyse qui importerait demain un repo passerait sous
 * une garde superficielle).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { reachable } from './import-graph';

const ENTRY = 'scripts/compare-models.ts';

/** Aucun fichier atteignable sous ces chemins : écriture, envoi, claims, surfaces. */
const FORBIDDEN_PREFIXES = [
  'src/lib/db/repos/',
  'src/lib/db/claims',
  'src/lib/email/',
  'src/lib/hitl/',
  'src/lib/imap/',
  'src/lib/scheduling/',
  'src/lib/scheduling-host/',
  'src/lib/candidatures/',
  'src/lib/vivier/',
  'src/lib/sourcing/',
  'src/app/',
];

/** Verbes d'écriture Supabase (base et stockage) et émetteurs. */
const FORBIDDEN_CALLS = [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/, /\.upload\(/, /\.remove\(/, /\.move\(/, /sendEmail/, /claimOutreach/];

describe('compare:models — aucune écriture, aucun envoi', () => {
  const graph = reachable(ENTRY);

  it('n’atteint AUCUN repo, émetteur, file HITL ni surface du produit', () => {
    const hits = graph.files.filter((f) => FORBIDDEN_PREFIXES.some((p) => f.startsWith(p)));
    expect(hits).toEqual([]);
  });

  it('seul le script parle à la base, et il ne fait que LIRE', () => {
    const talking = graph.files.filter((f) => readFileSync(join(process.cwd(), f), 'utf8').includes('@supabase/supabase-js'));
    expect(talking).toEqual([ENTRY]);
    const source = readFileSync(join(process.cwd(), ENTRY), 'utf8');
    for (const verb of FORBIDDEN_CALLS) expect(source).not.toMatch(verb);
  });

  it('le chemin d’analyse est bien celui du produit (sinon on ne mesurerait rien)', () => {
    expect(graph.files).toContain('src/lib/agents/server/cv-application-analyze.ts');
    expect(graph.files).toContain('src/lib/ai/provider.ts');
  });
});
