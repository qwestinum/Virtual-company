/**
 * Balayage de la base À LA RECHERCHE D'UN TÉMOIN — la preuve que « ORQA ne
 * conserve aucune transcription » (docs/specs/compte-rendu-entretien.md §12).
 *
 * TOUTES les tables du schéma, lues dans le fichier d'état final
 * (`scripts/migrate.sql`), jamais une liste recopiée : une table ajoutée
 * demain est balayée sans qu'on ait pensé à elle.
 *
 * Pour rester praticable sur une base de dev peuplée, chaque table est lue sur
 * la fenêtre du test : `updated_at` si la colonne existe, sinon `created_at`,
 * sinon la table ENTIÈRE (tables de configuration, petites). Chaque ligne est
 * sérialisée intégralement (colonnes `jsonb` comprises) avant la recherche.
 *
 * Une table illisible fait ÉCHOUER le balayage : un contrôle qui saute une
 * table sans le dire serait vert sans avoir tout lu.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listCreatedTables } from '@/lib/gdpr/schema-tables';

import { db } from './db';

const PAGE = 1000;

export type TraceScanResult = {
  /** Tables où le témoin a été trouvé (vide = aucune trace). */
  hits: string[];
  /** Tables effectivement lues (garde : le balayage a bien porté). */
  scanned: string[];
};

function isMissingTable(message: string): boolean {
  return /does not exist|schema cache|Could not find the table/iu.test(message);
}

export async function scanDatabaseFor(needle: string, sinceIso: string): Promise<TraceScanResult> {
  const tables = listCreatedTables(readFileSync(resolve(process.cwd(), 'scripts/migrate.sql'), 'utf8'));
  const hits: string[] = [];
  const scanned: string[] = [];

  for (const table of tables) {
    const probe = await db().from(table).select('*').limit(1);
    if (probe.error) {
      if (isMissingTable(probe.error.message)) continue; // base en retard d'une migration
      throw new Error(`balayage : table ${table} illisible — ${probe.error.message}`);
    }
    scanned.push(table);
    const sample = probe.data?.[0] as Record<string, unknown> | undefined;
    if (!sample) continue;
    const timeCol = 'updated_at' in sample ? 'updated_at' : 'created_at' in sample ? 'created_at' : null;

    for (let from = 0; ; from += PAGE) {
      let q = db().from(table).select('*').range(from, from + PAGE - 1);
      if (timeCol) q = q.gte(timeCol, sinceIso);
      const { data, error } = await q;
      if (error) throw new Error(`balayage : ${table} — ${error.message}`);
      const rows = data ?? [];
      if (rows.some((row) => JSON.stringify(row).includes(needle))) {
        hits.push(table);
        break;
      }
      if (rows.length < PAGE) break;
    }
  }
  return { hits, scanned };
}
