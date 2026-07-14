/**
 * Jeu de données À VOLUME pour valider les correctifs de troncature (audit C8).
 * DEV UNIQUEMENT — écrit en masse des données SYNTHÉTIQUES, zéro appel OpenAI.
 *
 * Pourquoi : les bugs de cap (1000 vivier, 200 exclusion, 500 journal) ne se
 * reproduisent qu'AU-DELÀ des seuils. Sans un jeu > 1000 en dev, la correction
 * est à l'aveugle. Ce script crée exactement ce dépassement, de façon
 * reproductible et nettoyable.
 *
 * Contenu (préfixe `seed_` / domaine `@volume.test` pour un nettoyage sûr) :
 *   - 1 300 vivier_candidates `indexed`, intitulé « Développeur » (matche la
 *     campagne de test au Bloc 1 déterministe) + ancre depth 0 + 3 skills, avec
 *     vecteurs 1536 PSEUDO-ALÉATOIRES SEEDÉS normalisés (provider/model =
 *     espace courant, passe le garde-fou). Le test valide l'EXHAUSTIVITÉ
 *     (comptages), pas la pertinence sémantique (couverte par les tests purs).
 *   - 300 candidate_analyses sur la campagne test, dont 250 emails ∈ vivier
 *     (validation de l'exclusion « déjà postulé » exhaustive).
 *   - 600 entrées journal `imap_cv_analyzed` (> fenêtre 500) pour vérifier les
 *     compteurs/rapports sur tables et non sur le journal tronqué.
 *
 * Usage :
 *   npm run seed:volume -- --campaign=CAMP-XXXX            # interactif (confirme le ref)
 *   npm run seed:volume -- --campaign=CAMP-XXXX --confirm-project=<ref>
 *   npm run seed:volume -- --clean --confirm-project=<ref> # supprime tout le seed
 *
 * Assertions à vérifier APRÈS seed (avant/après correctif) :
 *   - présélection : candidats considérés == count(*) vivier indexed (avant : 1000)
 *   - exclusion : les 250 « déjà postulé » TOUS exclus de la short-list (avant : ~200)
 *   - rapport de campagne : volumes == counts SQL (avant : tronqués à 1000/500)
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

loadEnvConfig(process.cwd());

const CANDIDATE_COUNT = 1300;
const ANALYSIS_COUNT = 300;
const OVERLAP_COUNT = 250; // analyses dont l'email ∈ vivier
const JOURNAL_COUNT = 600; // > fenêtre 500
const SEED_TAG = 'seed_volume';
const SEED_DOMAIN = '@volume.test';

type Args = { campaign: string | null; clean: boolean; confirmProject: string | null };

function parseArgs(argv: string[]): Args {
  const a: Args = { campaign: null, clean: false, confirmProject: null };
  for (const arg of argv) {
    if (arg === '--clean') a.clean = true;
    else if (arg.startsWith('--campaign=')) a.campaign = arg.split('=')[1] ?? null;
    else if (arg.startsWith('--confirm-project=')) a.confirmProject = arg.split('=')[1] ?? '';
  }
  return a;
}

function fail(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function projectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([^.]+)\.supabase\./);
    return m ? m[1] : host;
  } catch {
    return url;
  }
}

/** PRNG déterministe (mulberry32) — vecteurs reproductibles, zéro OpenAI. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vecteur 1536 pseudo-aléatoire NORMALISÉ (norme 1) → littéral pgvector. */
function randomVectorLiteral(rng: () => number): string {
  const v = Array.from({ length: 1536 }, () => rng() - 0.5);
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return `[${v.map((x) => (x / norm).toFixed(6)).join(',')}]`;
}

function embeddingSpace(): { provider: string; model: string } {
  return {
    provider: (process.env.EMBEDDING_PROVIDER ?? 'openai').trim().toLowerCase(),
    model: process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
  };
}

async function clean(supabase: SupabaseClient): Promise<void> {
  console.log('  Nettoyage du jeu de volume…');
  // Les embeddings/entités partent en CASCADE avec le candidat.
  await supabase.from('vivier_candidates').delete().like('email', `%${SEED_DOMAIN}`);
  await supabase.from('candidate_analyses').delete().like('candidate_email', `%${SEED_DOMAIN}`);
  await supabase.from('journal').delete().eq('actor', SEED_TAG);
  console.log('  ✓ Nettoyé (candidats, analyses, journal du seed).');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.local.');
  const ref = projectRef(url);

  // GARDE-FOU projet (pattern import-vivier) : confirmer le ref cible.
  if (args.confirmProject != null) {
    if (args.confirmProject.trim() !== ref) {
      fail(`--confirm-project="${args.confirmProject}" ≠ projet cible "${ref}".`);
    }
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(`\n  ⚠️  Écriture en masse sur « ${ref} ». Tape le ref pour confirmer : `);
    await rl.close();
    if (answer.trim() !== ref) fail('Confirmation du projet incorrecte — abandon.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (args.clean) {
    await clean(supabase);
    return;
  }
  if (!args.campaign) fail('--campaign=CAMP-XXXX requis (campagne de test active).');

  const { provider, model } = embeddingSpace();
  const rng = makeRng(42);

  // 1. Vivier : 1300 candidats indexés + ancre depth 0 + 3 skills.
  console.log(`  Insertion de ${CANDIDATE_COUNT} candidats vivier (indexed)…`);
  const emails: string[] = [];
  for (let batch = 0; batch < CANDIDATE_COUNT; batch += 100) {
    const rows = [];
    for (let i = batch; i < Math.min(batch + 100, CANDIDATE_COUNT); i++) {
      const email = `${SEED_TAG}_${i}${SEED_DOMAIN}`;
      emails.push(email);
      rows.push({
        email,
        nom: `Volume${i}`,
        prenom: 'Test',
        cv_text: `Développeur logiciel. Expérience ${i % 15} ans. React, Node, SQL.`,
        source: 'manual_upload',
        tags: [SEED_TAG],
        title: 'Développeur',
        title_variants: ['Developpeur', 'Ingénieur logiciel'],
        title_anchors: [{ depth: 0, text: 'Développeur', variants: ['Developpeur'] }],
        skills: ['react', 'node', 'sql'],
        indexing_status: 'indexed',
      });
    }
    const { data, error } = await supabase
      .from('vivier_candidates')
      .insert(rows)
      .select('id');
    if (error) fail(`insert candidats : ${error.message}`);
    const ids = (data ?? []) as { id: string }[];
    // Ancres + skills embeddings (vecteurs seedés).
    const anchorRows = ids.map((r) => ({
      candidate_id: r.id,
      depth: 0,
      anchor_text: 'Développeur',
      embedding: randomVectorLiteral(rng),
      provider,
      model,
    }));
    const skillRows = ids.flatMap((r) =>
      ['react', 'node', 'sql'].map((skill) => ({
        candidate_id: r.id,
        skill,
        embedding: randomVectorLiteral(rng),
        provider,
        model,
      })),
    );
    const [aErr, sErr] = await Promise.all([
      supabase.from('vivier_anchor_embeddings').insert(anchorRows).then((x) => x.error),
      supabase.from('vivier_skill_embeddings').insert(skillRows).then((x) => x.error),
    ]);
    if (aErr) fail(`insert ancres : ${aErr.message}`);
    if (sErr) fail(`insert skills : ${sErr.message}`);
    process.stdout.write(`\r  … ${Math.min(batch + 100, CANDIDATE_COUNT)}/${CANDIDATE_COUNT}`);
  }
  console.log('\n  ✓ Vivier seedé.');

  // 2. candidate_analyses : 300 dont 250 emails ∈ vivier (exclusion).
  console.log(`  Insertion de ${ANALYSIS_COUNT} analyses (${OVERLAP_COUNT} ∈ vivier)…`);
  const analysisRows = [];
  for (let i = 0; i < ANALYSIS_COUNT; i++) {
    const email = i < OVERLAP_COUNT ? emails[i]! : `${SEED_TAG}_app_${i}${SEED_DOMAIN}`;
    analysisRows.push({
      id: `${SEED_TAG}_an_${i}`,
      uid: `${SEED_TAG}_uid_${i}`,
      campaign_id: args.campaign,
      candidate_name: `App ${i}`,
      candidate_email: email,
      file_name: `cv-${i}.pdf`,
      source: 'email',
      total_score: 50 + (i % 40),
      status: i % 3 === 0 ? 'accepted' : 'rejected',
      criteria_version: 'seed',
      computed_at: new Date(2026, 0, 1 + (i % 180)).toISOString(),
      decision_zone: i % 3 === 0 ? 'auto_accept' : i % 3 === 1 ? 'gray' : 'auto_reject',
      application: {},
      received_at: new Date(2026, 0, 1 + (i % 180)).toISOString(),
    });
  }
  for (let b = 0; b < analysisRows.length; b += 100) {
    const { error } = await supabase.from('candidate_analyses').insert(analysisRows.slice(b, b + 100));
    if (error) fail(`insert analyses : ${error.message}`);
  }
  console.log('  ✓ Analyses seedées.');

  // 3. Journal : 600 entrées > fenêtre 500.
  console.log(`  Insertion de ${JOURNAL_COUNT} entrées journal (> 500)…`);
  // id = bigserial (auto). Nettoyage par `actor` distinctif (le journal n'a
  // pas d'id text ; les compteurs filtrent par `action`, pas `actor`).
  const journalRows = Array.from({ length: JOURNAL_COUNT }, (_, i) => ({
    campaign_id: args.campaign,
    actor: SEED_TAG,
    action: 'imap_cv_analyzed',
    payload: { uid: `${SEED_TAG}_uid_${i}`, seed: true },
  }));
  for (let b = 0; b < journalRows.length; b += 100) {
    const { error } = await supabase.from('journal').insert(journalRows.slice(b, b + 100));
    if (error) fail(`insert journal : ${error.message}`);
  }
  console.log('  ✓ Journal seedé.');

  console.log(`\n  ✅ Jeu de volume prêt sur « ${ref} », campagne ${args.campaign}.`);
  console.log('     Vérifie : présélection == count vivier indexed · 250 exclus · rapport == counts SQL.');
  console.log('     Nettoyage : npm run seed:volume -- --clean --confirm-project=' + ref);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
