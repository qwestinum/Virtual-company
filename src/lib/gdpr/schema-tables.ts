/**
 * Lecture du schéma `scripts/migrate.sql` — PUR, sans base.
 *
 * Sert au test d'exhaustivité de l'inventaire RGPD (`table-inventory.ts`) :
 * les tables qui EXISTENT se lisent dans le fichier d'état final, pas dans une
 * liste recopiée à la main — c'est précisément la liste recopiée qui a laissé
 * `job_postings` (09/09/2026) hors de la procédure d'effacement sans que rien
 * ne le signale.
 *
 * Volontairement minimal : ce n'est pas un analyseur SQL. Il reconnaît les
 * deux formes que le fichier emploie (`create table [if not exists]
 * [public.]nom (…)` et `alter table … add column … references …`) et ignore
 * les commentaires, qui citent parfois `create table` en toutes lettres.
 */

/** Retire les commentaires `--` (fin de ligne) et `/* … *\/`. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

const IDENT = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${IDENT}\s*\(`,
  'gi',
);

/** Noms des tables créées, dans l'ordre du fichier, sans doublon. */
export function listCreatedTables(sql: string): string[] {
  const out: string[] = [];
  for (const m of stripSqlComments(sql).matchAll(CREATE_TABLE)) {
    const name = m[1].toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Corps entre la parenthèse ouvrante (index donné) et sa fermante. */
function balancedBody(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

const CASCADE_REF = new RegExp(
  String.raw`\breferences\s+${IDENT}\s*(?:\([^)]*\))?\s*on\s+delete\s+cascade`,
  'gi',
);

const ALTER_ADD_REF = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${IDENT}\s+add\s+[^;]*?\breferences\s+${IDENT}\s*(?:\([^)]*\))?\s*on\s+delete\s+cascade`,
  'gi',
);

/**
 * Pour chaque table, les tables dont la suppression d'une ligne SUPPRIME ses
 * lignes (`references parent … on delete cascade`). `on delete set null` n'est
 * pas une cascade : la ligne survit, elle perd seulement son lien.
 */
export function listCascadeParents(sql: string): Map<string, Set<string>> {
  const text = stripSqlComments(sql);
  const parents = new Map<string, Set<string>>();
  const add = (child: string, parent: string): void => {
    const key = child.toLowerCase();
    if (!parents.has(key)) parents.set(key, new Set());
    parents.get(key)!.add(parent.toLowerCase());
  };

  for (const m of text.matchAll(CREATE_TABLE)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    for (const ref of balancedBody(text, open).matchAll(CASCADE_REF)) add(m[1], ref[1]);
  }
  for (const m of text.matchAll(ALTER_ADD_REF)) add(m[1], m[2]);
  return parents;
}
