/**
 * Exhaustivité de l'inventaire RGPD — chaque table du schéma a UN verdict, et
 * ce verdict est tenu par le document, le schéma et le code.
 *
 * Aucun test de logique ne pouvait voir qu'une table nouvelle (`job_postings`,
 * 09/09/2026) échappait à la procédure d'effacement : les listes de tables
 * étaient recopiées à la main. Ici on part du fichier d'état final
 * (`scripts/migrate.sql`), jamais d'une liste.
 *
 * Les gardes « code » sont STRUCTURELLES (présence du nom de table dans le
 * source), comme `scheduling/__tests__/frontier.test.ts` : elles ne prouvent
 * pas que le traitement est juste — les tests de `execute`/`verify` et S18 le
 * font — elles prouvent qu'il n'a pas été OUBLIÉ.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  listCascadeParents,
  listCreatedTables,
  stripSqlComments,
} from '@/lib/gdpr/schema-tables';
import {
  INVENTORIED_TABLES,
  TABLE_INVENTORY,
  type TableInventoryEntry,
  type TableVerdict,
} from '@/lib/gdpr/table-inventory';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

const SQL = read('scripts/migrate.sql');
const DOC = read('docs/ops/purge-rgpd-candidat.md');
const EXECUTE = read('src/lib/gdpr/execute.ts');
const CONTROL = read('src/lib/gdpr/verify.ts') + read('src/lib/gdpr/journal-scope.ts');

const inventory: Record<string, TableInventoryEntry> = TABLE_INVENTORY;

/** Lignes du tableau §4.1 : `nom` → verdict (le premier des trois mots cités). */
function docVerdicts(md: string): Map<string, TableVerdict> {
  const start = md.indexOf('### 4.1');
  const end = md.indexOf('\n### ', start + 1);
  const section = md.slice(start, end === -1 ? undefined : end);
  const out = new Map<string, TableVerdict>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const verdict = cells[3]?.match(/EFFACER|PSEUDONYMISER|CONSERVER/)?.[0] as TableVerdict | undefined;
    if (!verdict) continue;
    for (const m of cells[1].matchAll(/`([a-z_][a-z0-9_]*)`/g)) out.set(m[1], verdict);
  }
  return out;
}

describe('lecture du schéma', () => {
  it('ignore un « create table » cité dans un commentaire', () => {
    const sql = `-- NB : \`create table if not exists\` n'altère pas…\ncreate table if not exists public.a (id int);\n/* create table b ( */`;
    expect(listCreatedTables(sql)).toEqual(['a']);
  });

  it('reconnaît les variantes d’écriture', () => {
    const sql = 'create table public.a (x int);\nCREATE TABLE IF NOT EXISTS b(x int);\ncreate unlogged table "c" (x int);';
    expect(listCreatedTables(sql)).toEqual(['a', 'b', 'c']);
  });

  it('distingue la cascade du `set null`, y compris via `alter table … add column`', () => {
    const sql = [
      'create table if not exists public.p (id uuid primary key);',
      'create table if not exists public.c (',
      '  id uuid, p_id uuid references public.p(id) on delete cascade,',
      '  q_id uuid references public.q(id) on delete set null',
      ');',
      'alter table public.d',
      '  add column if not exists p_id uuid references public.p(id) on delete cascade;',
    ].join('\n');
    const parents = listCascadeParents(sql);
    expect([...(parents.get('c') ?? [])]).toEqual(['p']);
    expect([...(parents.get('d') ?? [])]).toEqual(['p']);
  });

  it('le schéma réel est lu (garde contre un analyseur qui ne trouverait rien)', () => {
    expect(listCreatedTables(SQL).length).toBeGreaterThanOrEqual(30);
    expect(stripSqlComments(SQL)).not.toMatch(/--/);
  });
});

describe('inventaire RGPD — exhaustivité', () => {
  const tables = listCreatedTables(SQL);

  it('chaque table du schéma a un verdict', () => {
    const missing = tables.filter((t) => !(t in inventory));
    expect(
      missing,
      `Table(s) sans verdict RGPD : ${missing.join(', ')}. ` +
        'Ajouter une entrée dans src/lib/gdpr/table-inventory.ts ET une ligne au §4.1 ' +
        'de docs/ops/purge-rgpd-candidat.md.',
    ).toEqual([]);
  });

  it('aucun verdict pour une table qui n’existe plus', () => {
    const orphans = INVENTORIED_TABLES.filter((t) => !tables.includes(t));
    expect(orphans, `Verdict(s) orphelin(s) : ${orphans.join(', ')}.`).toEqual([]);
  });

  it('le document (§4.1) porte chaque table avec le même verdict', () => {
    const doc = docVerdicts(DOC);
    const problems: string[] = [];
    for (const t of INVENTORIED_TABLES) {
      const d = doc.get(t);
      if (!d) problems.push(`${t} : absente du §4.1`);
      else if (d !== TABLE_INVENTORY[t].verdict) problems.push(`${t} : ${d} au document, ${TABLE_INVENTORY[t].verdict} au registre`);
    }
    for (const t of doc.keys()) if (!(t in inventory)) problems.push(`${t} : au document, pas au registre`);
    expect(problems).toEqual([]);
  });
});

describe('inventaire RGPD — le traitement déclaré est tenu', () => {
  const cascades = listCascadeParents(SQL);

  for (const t of INVENTORIED_TABLES) {
    const entry: TableInventoryEntry = TABLE_INVENTORY[t];
    if (entry.verdict === 'CONSERVER') continue;
    const { treatment } = entry;

    if (treatment.kind === 'step') {
      it(`${t} : nommée par l’effacement et relue par le contrôle final`, () => {
        expect(EXECUTE, `${t} absente de execute.ts`).toContain(`'${t}'`);
        expect(CONTROL, `${t} absente de verify.ts / journal-scope.ts`).toContain(`'${t}'`);
      });
    } else {
      it(`${t} : supprimée en cascade depuis ${treatment.parent}, lui-même effacé`, () => {
        expect([...(cascades.get(t) ?? [])]).toContain(treatment.parent);
        expect(inventory[treatment.parent]?.verdict).toBe('EFFACER');
      });
    }
  }
});
