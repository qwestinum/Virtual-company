/**
 * Réindexation batch du vivier (docs/specs/vivier.md §3.4 / §4).
 *
 * Régénère, pour chaque dossier (via `indexVivierCandidate`) : entités, TITRE
 * (+ repli), VARIANTES du titre (iso-rôle anglais), EMBEDDING DU TITRE, les
 * ANCRES de titre (titre déclaré + 2 derniers postes, variantes par ancre), ET
 * UN EMBEDDING PAR ANCRE (Bloc 2 sémantique multi-ancres ; depth 0 réutilise le
 * vecteur du titre), ET les COMPÉTENCES atomiques + UN EMBEDDING PAR COMPÉTENCE
 * (set-to-set) — les signaux de la présélection. (Full-CV plus régénéré.)
 *
 * Reindex COMPLET obligatoire après l'ajout des compétences (Chantier 3) : les
 * dossiers non réindexés ont skills=∅ ⇒ couverture 0 (dégradation douce vers le
 * titre seul) jusqu'au reindex.
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
 *   3. RATTRAPAGE DES DOSSIERS RESTÉS « EN COURS ». `--only-pending` reprend
 *      les dossiers `pending` — ceux dont l'indexation n'a JAMAIS abouti, ni en
 *      succès ni en échec. Sur Vercel, la porte email les produit en série : le
 *      poller lance l'alimentation du vivier en promesse FLOTTANTE et
 *      l'instance est gelée dès que la réponse du cron part (cf. `poller.ts`,
 *      `feedVivierFromApplication`). Le dossier existe, il n'est jamais
 *      indexé — donc **invisible à la présélection**, qui ne lit que
 *      `indexing_status = 'indexed'`. Ce rattrapage les remet dans le jeu ; le
 *      correctif durable est un rail de reprise, pas ce script.
 *
 * La réindexation réutilise `indexVivierCandidate` (idempotent, repositionne le
 * statut) : aucune logique d'indexation dupliquée ici.
 *
 * Usage :
 *   npm run reindex:vivier -- --env .env.local                 # tous les dossiers
 *   npm run reindex:vivier -- --env .env.local --only-failed
 *   npm run reindex:vivier -- --env .env.local --only-pending
 *   npm run reindex:vivier -- --env .env.local --only-pending --dry-run
 *   npm run reindex:vivier -- --env .env.prod.local --only-pending --confirm-project=<ref>
 *
 * ⚠️ `--env` est OBLIGATOIRE, sans repli : ce script ÉCRIT (statuts, titres,
 * embeddings), et l'environnement visé se nomme — il ne se devine pas. Même
 * règle que la purge RGPD, pour le même piège : un fichier au nom de dev peut
 * pointer la base du client. La référence du projet RÉELLEMENT visé est
 * imprimée, et retapée avant toute écriture (`--confirm-project=<ref>` hors
 * terminal interactif).
 *
 * Pré-requis : le fichier d'environnement porte l'accès Supabase service_role et
 * la clé du provider d'embeddings courant. Traitement SÉQUENTIEL volontaire
 * (opération de maintenance non urgente, doux pour les quotas d'API).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

type Options = {
  onlyFailed: boolean;
  onlyPending: boolean;
  dryRun: boolean;
  envPath: string | null;
  confirmProject: string | null;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    onlyFailed: false,
    onlyPending: false,
    dryRun: false,
    envPath: null,
    confirmProject: null,
  };
  for (const arg of argv) {
    if (arg === '--only-failed') opts.onlyFailed = true;
    else if (arg === '--only-pending') opts.onlyPending = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--env=')) opts.envPath = arg.slice('--env='.length);
    else if (arg.startsWith('--confirm-project='))
      opts.confirmProject = arg.slice('--confirm-project='.length);
    else {
      console.error(`Option inconnue : ${arg}`);
      console.error(
        'Options : --env=<fichier> (obligatoire), --only-failed, --only-pending, --dry-run, --confirm-project=<ref>',
      );
      process.exit(1);
    }
  }
  if (opts.onlyFailed && opts.onlyPending) {
    console.error(
      '--only-failed et --only-pending s’excluent : choisissez un périmètre, ou aucun pour tout réindexer.',
    );
    process.exit(1);
  }
  return opts;
}

/** Lecture d'un fichier d'environnement — même format que la purge RGPD. */
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    console.error(`[reindex-vivier] Fichier d'environnement introuvable : ${path}`);
    process.exit(1);
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/gu, '');
  }
}

/** Référence du projet Supabase visé — imprimée, puis retapée. */
function projectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.match(/^([^.]+)\.supabase\./)?.[1] ?? host;
  } catch {
    return url;
  }
}

async function confirmTarget(ref: string, confirmProject: string | null): Promise<void> {
  if (confirmProject !== null) {
    if (confirmProject.trim() !== ref) {
      console.error(
        `--confirm-project="${confirmProject}" ≠ projet visé "${ref}" — écriture refusée.`,
      );
      process.exit(1);
    }
    return;
  }
  if (!process.stdin.isTTY) {
    console.error(
      `Pas de terminal interactif : ajoutez --confirm-project=${ref} pour confirmer le projet visé.`,
    );
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n  Tapez la référence du projet pour confirmer l'écriture (« ${ref} ») : `);
  rl.close();
  if (answer.trim() !== ref) {
    console.error('Confirmation incorrecte — aucune écriture effectuée.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { onlyFailed, onlyPending, dryRun, envPath, confirmProject } = parseArgs(
    process.argv.slice(2),
  );
  if (!envPath) {
    console.error(
      "[reindex-vivier] --env=<fichier> est obligatoire (ex. --env=.env.local). Aucun repli : l'environnement visé se nomme, il ne se devine pas.",
    );
    process.exit(1);
  }
  // Charger l'environnement AVANT d'importer les modules qui le lisent.
  loadEnvFile(envPath);
  const ref = projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  console.log(`[reindex-vivier] projet visé : ${ref} (via ${envPath})`);

  // Import différé : ces modules lisent l'environnement à l'import.
  const { listVivierCandidateIds } = await import('@/lib/db/repos/vivier');
  const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
  const { SupabaseNotConfiguredError } = await import('@/lib/db/supabase-server');

  const scope = onlyFailed
    ? 'dossiers en échec (failed)'
    : onlyPending
      ? 'dossiers restés en cours (pending)'
      : 'tous les dossiers';
  console.log(
    `[reindex-vivier] périmètre : ${scope}${dryRun ? ' — DRY RUN (aucune écriture)' : ''}`,
  );

  let ids: string[];
  try {
    ids = await listVivierCandidateIds(
      onlyFailed
        ? { status: 'failed' }
        : onlyPending
          ? { status: 'pending' }
          : undefined,
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

  // Rien à confirmer quand il n'y a rien à écrire.
  if (ids.length === 0) {
    console.log('[reindex-vivier] rien à faire.');
    return;
  }
  await confirmTarget(ref, confirmProject);

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
