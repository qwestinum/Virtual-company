/**
 * Backfill de l'origine vivier sur l'historique des candidatures.
 *
 * Le menu Candidatures lit `candidate_analyses.from_vivier` (dénormalisé, posé
 * au rapprochement par `matchVivierApplication`). Les candidatures ANTÉRIEURES
 * à ce lot ne l'ont pas → le filtre « Issues du vivier » serait vide au départ.
 * Ce script le pose rétroactivement, en RÉUTILISANT exactement la logique du
 * rapprochement live (mêmes repos, aucun second chemin) :
 *
 *   pour chaque analyse from_vivier=false avec (campagne, email) :
 *     dossier vivier par email exact ? ET proposition CONTACTÉE pour la
 *     campagne ? → from_vivier=true + vivier_candidate_id.
 *
 * IDEMPOTENT : ne traite que les lignes `from_vivier=false` (pagination keyset
 * sur l'id → jamais de boucle, jamais de saut). Relancer ne change rien aux
 * lignes déjà posées.
 *
 * SÛRETÉ : écrit via la service_role de `.env.local`. DEV D'ABORD, puis prod
 * client une fois vérifié. `--dry-run` simule sans écrire.
 *
 * Usage :
 *   npm run backfill:from-vivier
 *   npm run backfill:from-vivier -- --dry-run
 *   npm run backfill:from-vivier -- --limit=500
 */

import { loadEnvConfig } from '@next/env';

type Args = { dryRun: boolean; limit: number | null };

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = null;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) limit = Math.trunc(n);
    }
  }
  return { dryRun, limit };
}

function projectRef(url: string): string {
  const m = url.match(/https?:\/\/([^.]+)\./);
  return m ? m[1] : url;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { dryRun, limit } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.error('NEXT_PUBLIC_SUPABASE_URL absent de .env.local — cible inconnue.');
    process.exit(1);
  }
  console.log(
    `Projet cible : ${projectRef(url)}${dryRun ? '  (DRY-RUN, aucune écriture)' : ''}`,
  );

  // Import APRÈS loadEnvConfig (le client Supabase lit l'env au premier appel).
  const { requireServerSupabase } = await import('@/lib/db/supabase-server');
  const { getVivierCandidateByEmail } = await import('@/lib/db/repos/vivier');
  const { findContactedProposalByEmail } = await import(
    '@/lib/db/repos/vivier-preselection'
  );
  const { markAnalysisFromVivier } = await import(
    '@/lib/db/repos/candidate-analyses'
  );
  const { normalizeEmail } = await import('@/lib/vivier/candidates');

  const supabase = requireServerSupabase();
  const PAGE = 500;
  let cursor = '';
  let scanned = 0;
  let matched = 0;

  for (;;) {
    let q = supabase
      .from('candidate_analyses')
      .select('id, campaign_id, candidate_email')
      .eq('from_vivier', false)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) {
      console.error(`Lecture échouée : ${error.message}`);
      process.exit(1);
    }
    const rows = (data ?? []) as Array<{
      id: string;
      campaign_id: string | null;
      candidate_email: string | null;
    }>;
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned += 1;
      if (!row.campaign_id || !row.candidate_email) continue;
      const email = normalizeEmail(row.candidate_email);
      try {
        const candidate = await getVivierCandidateByEmail(email);
        if (!candidate) continue;
        const contacted = await findContactedProposalByEmail(row.campaign_id, email);
        if (!contacted) continue;
        if (!dryRun) await markAnalysisFromVivier(row.id, candidate.id);
        matched += 1;
        console.log(`  ✓ ${row.id} ← vivier ${candidate.id}`);
      } catch (err) {
        console.error(`  ! ${row.id} : ${(err as Error).message}`);
      }
      if (limit && scanned >= limit) break;
    }
    if (limit && scanned >= limit) break;
  }

  console.log(
    `Terminé. ${scanned} analyses examinées, ${matched} marquées « issues du vivier »` +
      `${dryRun ? ' (simulation)' : ''}.`,
  );
}

void main();
