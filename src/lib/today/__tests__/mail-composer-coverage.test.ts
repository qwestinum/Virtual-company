/**
 * Garde STRUCTURELLE — tout mail écrit à un candidat est compté par le Mail
 * Composer de la bande d'*Aujourd'hui* (27/09/2026).
 *
 * Défaut d'origine : la bande ne connaissait que les envois automatiques ;
 * une acceptation envoyée après la décision du recruteur, puis une invitation
 * renvoyée depuis Entretiens, laissaient le compteur à 0 juste après l'envoi.
 * Chaque chemin d'envoi au candidat journalise `mailSent` (le fait que le mail
 * est PARTI) : toute entrée de journal qui le porte doit être une source du
 * Mail Composer. Un chemin ajouté demain sans l'y inscrire fait rougir ici.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENT_BAND } from '@/lib/today/agents-band';

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

/** Actions journalisées avec `mailSent` dans leur payload. */
function actionsCarryingMailSent(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    for (const m of src.matchAll(/appendJournalEntry\(\{\s*action:\s*'([a-z_]+)'/g)) {
      const rest = src.slice(m.index ?? 0);
      const block = rest.slice(0, rest.indexOf('});'));
      if (/\bmailSent\b/.test(block)) found.add(m[1]!);
    }
  }
  return found;
}

describe('le Mail Composer compte chaque mail écrit à un candidat', () => {
  const mail = AGENT_BAND.find((a) => a.id === 'agent.mail-composer');
  const counted = new Set(mail?.sources.map((s) => s.action));

  it('toute entrée qui dit si un mail est parti est une source du Mail Composer', () => {
    const carrying = actionsCarryingMailSent();
    // Sans ce contrôle, un changement de forme du journal viderait l'ensemble
    // et la garde deviendrait verte pour de mauvaises raisons.
    expect(carrying.size).toBeGreaterThanOrEqual(3);
    const missing = [...carrying].filter((a) => !counted.has(a));
    expect(
      missing,
      'Un envoi au candidat n’est pas compté : ajoutez-le aux sources du Mail ' +
        'Composer (`src/lib/today/agents-band.ts`), filtré sur mailSent = true.',
    ).toEqual([]);
  });
});
