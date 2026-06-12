/**
 * Réindexation batch du vivier (docs/specs/vivier.md §3.4 / §4).
 *
 * Régénère, pour chaque dossier (via `indexVivierCandidate`) : entités, TITRE
 * (+ repli), VARIANTES du titre, et EMBEDDING DU TITRE — les signaux de la
 * présélection refondue. (L'embedding full-CV n'est plus régénéré.)
 *
 * Deux usages :
 *   1. BASCULE DE FOURNISSEUR/MODÈLE D'EMBEDDINGS. Deux providers (ou deux
 *      modèles) produisent des espaces vectoriels NON comparables : après tout
 *      changement de EMBEDDING_PROVIDER / OPENAI_EMBEDDING_MODEL, les embeddings
 *      titre existants sont caducs. Ce script les régénère avec le modèle
 *      courant (seule voie de récupération — sinon la présélection compare des
 *      espaces incompatibles, ce que le garde-fou refuse).
 *   2. RATTRAPAGE DES DOSSIERS EN ÉCHEC. `--only-failed` ne retraite que les
 *      dossiers `failed` (ex. coupures d'API pendant un import de masse).
 *
 * La réindexation réutilise `indexVivierCandidate` (idempotent, repositionne le
 * statut) : aucune logique d'indexation dupliquée ici.
 *
 * Usage :
 *   npm run reindex:vivier                 # tous les dossiers
 *   npm run reindex:vivier -- --only-failed
 *   npm run reindex:vivier -- --dry-run    # liste sans rien écrire
 *   npm run reindex:vivier -- --only-failed --dry-run
 *
 * Pré-requis : .env.local renseigné (accès Supabase service_role + clé du
 * provider d'embeddings courant). Traitement SÉQUENTIEL volontaire (opération de
 * maintenance non urgente, doux pour les quotas d'API).
 */

import { loadEnvConfig } from '@next/env';

type Options = { onlyFailed: boolean; dryRun: boolean };

function parseArgs(argv: string[]): Options {
  const opts: Options = { onlyFailed: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--only-failed') opts.onlyFailed = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else {
      console.error(`Option inconnue : ${arg}`);
      console.error('Options : --only-failed, --dry-run');
      process.exit(1);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  // Charger .env.local AVANT d'importer les modules qui lisent l'environnement.
  loadEnvConfig(process.cwd());

  const { onlyFailed, dryRun } = parseArgs(process.argv.slice(2));

  // Import différé : ces modules lisent l'environnement à l'import.
  const { listVivierCandidateIds } = await import('@/lib/db/repos/vivier');
  const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
  const { SupabaseNotConfiguredError } = await import('@/lib/db/supabase-server');

  const scope = onlyFailed ? 'dossiers en échec (failed)' : 'tous les dossiers';
  console.log(
    `[reindex-vivier] périmètre : ${scope}${dryRun ? ' — DRY RUN (aucune écriture)' : ''}`,
  );

  let ids: string[];
  try {
    ids = await listVivierCandidateIds(
      onlyFailed ? { status: 'failed' } : undefined,
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      console.error(
        '[reindex-vivier] Supabase non configuré : renseignez .env.local (URL + service_role).',
      );
      process.exit(1);
    }
    throw err;
  }

  console.log(`[reindex-vivier] ${ids.length} dossier(s) à traiter.`);

  if (dryRun) {
    for (const id of ids) console.log(`  • ${id}`);
    console.log(
      `[reindex-vivier] DRY RUN terminé — ${ids.length} dossier(s) auraient été réindexés.`,
    );
    return;
  }

  let indexed = 0;
  let failed = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const result = await indexVivierCandidate(id);
    if (result.status === 'indexed') {
      indexed++;
    } else {
      failed++;
      failures.push({ id, error: result.error ?? 'inconnu' });
    }
    // Progression tous les 25 dossiers (et au dernier).
    if ((i + 1) % 25 === 0 || i === ids.length - 1) {
      console.log(
        `[reindex-vivier] ${i + 1}/${ids.length} — ${indexed} indexés, ${failed} en échec`,
      );
    }
  }

  if (failures.length > 0) {
    console.log('[reindex-vivier] dossiers en échec :');
    for (const f of failures) console.log(`  ✗ ${f.id} — ${f.error}`);
  }
  console.log(
    `[reindex-vivier] terminé : ${indexed} indexés, ${failed} en échec sur ${ids.length}.`,
  );
  // Sortie non-zéro si au moins un échec subsiste (utile en CI / cron).
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[reindex-vivier] échec inattendu :', err);
  process.exitCode = 1;
});
