/**
 * Graphe d'imports STATIQUE d'un fichier — outil de test, sans dépendance.
 * Suit `import … from`, `export … from` et `import('…')` ; ignore
 * `import type` (effacé à la compilation, il n'exécute rien).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  if (existsSync(base) && /\.(ts|tsx)$/.test(base)) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  return null;
}

export function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const stmt = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/g;
  for (let m = stmt.exec(source); m; m = stmt.exec(source)) if (!m[2]) out.push(m[3]!);
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (let m = bare.exec(source); m; m = bare.exec(source)) out.push(m[1]!);
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dyn.exec(source); m; m = dyn.exec(source)) out.push(m[1]!);
  return out;
}

/** Fichiers LOCAUX atteignables (chemins relatifs à la racine) et paquets externes. */
export function reachable(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const local = resolveLocal(spec, file);
      if (local) stack.push(local);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec);
    }
  }
  return { files: [...seen].map((f) => relative(ROOT, f)).sort(), packages: [...packages].sort() };
}
