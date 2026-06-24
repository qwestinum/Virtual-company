/**
 * Import EN MASSE d'un stock de CV dans le vivier (usage interne, hors app/Vercel).
 *
 * Lancé en LOCAL depuis ma machine sur un dossier de CV (~1600), il corrige les
 * trois défauts du glisser-déposer de l'app :
 *   - TIMEOUTS         → traitement par LOTS séquentiels, parallélisme borné,
 *                        pause configurable entre lots (doux pour les quotas).
 *   - FAUX « indexé »  → un CV n'est RÉUSSI qu'après confirmation SYNCHRONE de
 *                        TOUTES les étapes (extraction + identité + écriture +
 *                        indexation) ET re-vérification que l'embedding titre a
 *                        bien été écrit dans le BON espace (double protection
 *                        contre l'`indexed` creux — cf. docs/BACKLOG.md couche 2).
 *   - REJEU UNITAIRE   → journal de progression local (JSON), reprise idempotente :
 *                        relancer SAUTE les réussis + doublons, ne RETENTE que les
 *                        échecs et les non-traités.
 *
 * Il RÉUTILISE le pipeline d'indexation existant (mêmes fonctions que `/api/vivier`
 * POST), sans en dupliquer la logique :
 *   extractCVText → extractCandidateIdentity → upsertVivierCandidate → indexVivierCandidate
 * et lit le résultat via getVivierEmbeddingMeta. Aucun second chemin d'indexation.
 *
 * Sécurité : écrit dans la base du PROJET CLIENT via les credentials de `.env.local`
 * (Supabase service_role + clé OpenAI/embeddings). Le projet cible est AFFICHÉ et
 * doit être CONFIRMÉ par saisie de son `project ref` avant toute écriture. Un
 * contrôle PRÉ-VOL refuse de démarrer si l'espace d'embedding du vivier existant
 * diverge du modèle courant (sinon la présélection compare des espaces incompatibles).
 *
 * Usage :
 *   npm run import:vivier -- <dossier>
 *   npm run import:vivier -- <dossier> --dry-run --limit=20    # simulation, aucune écriture
 *   npm run import:vivier -- <dossier> --retry-failed-only      # ne reprend que les échecs
 *   npm run import:vivier -- <dossier> --batch-size=3 --delay-ms=2000 --max-retries=6
 *   npm run import:vivier -- <dossier> --confirm-project=<ref>  # non-interactif (pas de TTY)
 *
 * Rate-limits OpenAI : le provider ne retente PAS les 429 ; ce script les absorbe
 * (backoff respectant l'indice « try again in Xs »), donc sur une org bas palier
 * (ex. 30k TPM) l'import s'auto-régule et peut être long — c'est attendu. Reprise :
 * relancer (idempotent) ou --retry-failed-only. Un dossier existant non-indexé
 * (échec d'indexation précédent, ou dossier creux de l'app) est RÉINDEXÉ, pas sauté.
 *
 * Pré-requis : `.env.local` renseigné (URL Supabase + service_role + clé d'embeddings).
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { loadEnvConfig } from '@next/env';

// ── Types ───────────────────────────────────────────────────────────────────

type EntryStatus = 'succeeded' | 'failed' | 'skipped_no_email' | 'duplicate_ignored';

type JournalEntry = {
  status: EntryStatus;
  email: string | null;
  candidateId: string | null;
  /** Motif d'échec / de saut (ex. `extract:empty_text`, `embedding_absent`). */
  reason: string | null;
  attempts: number;
  updatedAt: string;
};

type Journal = {
  version: 1;
  /** project ref capturé à la 1ʳᵉ run — refus si une run ultérieure vise un AUTRE projet. */
  targetProjectRef: string;
  /** Espace d'embedding (`provider|model`) au démarrage — refus si le modèle a changé. */
  embeddingSpace: string;
  rootDir: string;
  startedAt: string;
  updatedAt: string;
  /** Clé = chemin RELATIF au dossier racine (stable, gère les sous-dossiers). */
  entries: Record<string, JournalEntry>;
};

type Options = {
  dir: string;
  dryRun: boolean;
  retryFailedOnly: boolean;
  limit: number | null;
  batchSize: number;
  delayMs: number;
  /** Nombre max de reprises sur rate-limit OpenAI (429) par appel/indexation. */
  maxRetries: number;
  confirmProject: string | null;
};

const SUPPORTED_EXT = new Set(['.pdf', '.docx', '.txt', '.md']);
const JOURNAL_NAME = '.import-vivier-journal.json';
const DRYRUN_JOURNAL_NAME = '.import-vivier-journal.dryrun.json';

// ── Helpers purs ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dir: '',
    dryRun: false,
    retryFailedOnly: false,
    limit: null,
    // Défauts prudents pour une org OpenAI bas palier (ex. Tier-1 = 30k TPM) :
    // peu de parallélisme, le backoff 429 fait le reste (auto-régulation).
    batchSize: 3,
    delayMs: 2000,
    maxRetries: 6,
    confirmProject: null,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--retry-failed-only') opts.retryFailedOnly = true;
    else if (arg.startsWith('--limit=')) opts.limit = parsePositiveInt(arg, 'limit');
    else if (arg.startsWith('--batch-size=')) opts.batchSize = parsePositiveInt(arg, 'batch-size');
    else if (arg.startsWith('--delay-ms=')) opts.delayMs = parseNonNegativeInt(arg, 'delay-ms');
    else if (arg.startsWith('--max-retries=')) opts.maxRetries = parseNonNegativeInt(arg, 'max-retries');
    else if (arg.startsWith('--confirm-project=')) opts.confirmProject = arg.split('=')[1] ?? '';
    else if (arg.startsWith('--')) fail(`Option inconnue : ${arg}`);
    else if (!opts.dir) opts.dir = arg;
    else fail(`Argument inattendu : ${arg}`);
  }
  if (!opts.dir) {
    fail('Dossier manquant. Usage : npm run import:vivier -- <dossier> [options]');
  }
  return opts;
}

function parsePositiveInt(arg: string, name: string): number {
  const n = Number(arg.split('=')[1]);
  if (!Number.isInteger(n) || n <= 0) fail(`--${name} doit être un entier > 0.`);
  return n;
}

function parseNonNegativeInt(arg: string, name: string): number {
  const n = Number(arg.split('=')[1]);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} doit être un entier ≥ 0.`);
  return n;
}

function fail(message: string): never {
  console.error(`[import-vivier] ${message}`);
  process.exit(1);
}

/** Déduit le `project ref` de l'URL Supabase (`https://<ref>.supabase.co`). */
function supabaseProjectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([^.]+)\.supabase\./);
    return m ? m[1] : host;
  } catch {
    return url;
  }
}

/** Espace d'embedding courant (`provider|model`) — même convention que le repo. */
function expectedEmbeddingSpace(): string {
  const provider = (process.env.EMBEDDING_PROVIDER ?? 'openai').trim().toLowerCase();
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  return `${provider}|${model}`;
}

function mimeForExt(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.md') return 'text/markdown';
  return 'text/plain';
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Liste récursive des CV supportés (chemins RELATIFS au dossier, triés). Ignore les cachés. */
async function scanDir(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // cachés + journaux
      const abs = join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && SUPPORTED_EXT.has(extname(e.name).toLowerCase())) {
        found.push(relative(root, abs));
      }
    }
  }
  await walk(root);
  return found.sort();
}

/**
 * Plan de travail (run réelle) : SAUTE les terminaux (réussis, doublons, sans
 * email), RETIENT les échecs + les non-traités. `--retry-failed-only` = échecs seuls.
 */
function planWork(files: string[], journal: Journal, opts: Options): string[] {
  const planned = files.filter((rel) => {
    const e = journal.entries[rel];
    if (opts.retryFailedOnly) return e?.status === 'failed';
    if (!e) return true; // non-traité
    return e.status === 'failed';
  });
  return opts.limit != null ? planned.slice(0, opts.limit) : planned;
}

// ── Journal I/O (écritures sérialisées) ──────────────────────────────────────

let journalWriteChain: Promise<void> = Promise.resolve();

function saveJournal(path: string, journal: Journal): Promise<void> {
  journal.updatedAt = new Date().toISOString();
  const snapshot = JSON.stringify(journal, null, 2);
  journalWriteChain = journalWriteChain
    .catch(() => {})
    .then(() => writeFile(path, snapshot, 'utf-8'));
  return journalWriteChain;
}

async function loadJournal(path: string): Promise<Journal | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Journal;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ── Confirmation du projet cible ─────────────────────────────────────────────

async function confirmTarget(ref: string, opts: Options): Promise<void> {
  if (opts.confirmProject != null) {
    if (opts.confirmProject.trim() !== ref) {
      fail(
        `--confirm-project="${opts.confirmProject}" ≠ projet cible "${ref}". ` +
          `Écriture refusée (mauvais projet ?).`,
      );
    }
    return;
  }
  if (!process.stdin.isTTY) {
    fail(
      `Pas de terminal interactif : fournis --confirm-project=${ref} pour confirmer le projet cible.`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n  Tape le project ref pour confirmer l'écriture (« ${ref} ») : `);
  rl.close();
  if (answer.trim() !== ref) {
    fail('Confirmation incorrecte — aucune écriture effectuée.');
  }
}

// ── Pipeline réutilisé (dépendances injectées) ───────────────────────────────

type Deps = Awaited<ReturnType<typeof loadDeps>>;

async function loadDeps() {
  // Import différé : ces modules lisent l'environnement à l'import/à l'appel.
  const { extractCVText, CVExtractError } = await import('@/lib/agents/cv-extract');
  const { extractCandidateIdentity } = await import('@/lib/agents/candidate-identity');
  const { AIValidationError } = await import('@/lib/ai/errors');
  const { normalizeEmail, upsertVivierCandidate } = await import('@/lib/vivier/candidates');
  const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
  const {
    getVivierCandidateByEmail,
    getVivierEmbeddingMeta,
    listDistinctEmbeddingModels,
  } = await import('@/lib/db/repos/vivier');
  return {
    extractCVText,
    CVExtractError,
    extractCandidateIdentity,
    AIValidationError,
    normalizeEmail,
    upsertVivierCandidate,
    indexVivierCandidate,
    getVivierCandidateByEmail,
    getVivierEmbeddingMeta,
    listDistinctEmbeddingModels,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Gestion des rate-limits OpenAI (429) ─────────────────────────────────────
// Le provider NE retente PAS les 429 (provider.ts : les erreurs transport se
// propagent sans retry). Sur une org bas palier (30k TPM) un import sature vite.
// On absorbe ça ICI : reprise avec attente qui RESPECTE l'indice « try again in
// Xs » d'OpenAI → le script s'auto-régule sur la limite au lieu d'échouer en masse.

/** Détecte une erreur de rate-limit (429) à partir d'un message. */
function isRateLimit(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /\b429\b|rate limit|too many requests/i.test(msg);
}

/** Délai suggéré par OpenAI (« try again in 2.548s ») en ms, sinon null. */
function parseRetryAfterMs(msg: string): number | null {
  const m = msg.match(/try again in\s+([\d.]+)\s*s/i);
  if (!m) return null;
  const s = Number(m[1]);
  return Number.isFinite(s) ? Math.ceil(s * 1000) : null;
}

/** Backoff : indice OpenAI si présent (+ marge), sinon exponentiel borné, + jitter. */
function backoffMs(msg: string, attempt: number): number {
  const hinted = parseRetryAfterMs(msg);
  const base =
    hinted != null ? hinted + 750 : Math.min(60_000, 2_000 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 500);
}

/** Retente `fn` UNIQUEMENT sur rate-limit (les autres erreurs se propagent). */
async function withRateLimitRetry<T>(
  label: string,
  maxRetries: number,
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = errMsg(err);
      if (!isRateLimit(msg) || attempt > maxRetries) throw err;
      const wait = backoffMs(msg, attempt);
      console.log(
        `    ⏳ ${label} : rate-limit (essai ${attempt}/${maxRetries}) — pause ${Math.round(wait / 1000)}s`,
      );
      await sleep(wait);
    }
  }
}

type IndexOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Indexe `candidateId` (idempotent) + VÉRIFIE l'embedding titre présent dans le
 * BON espace (réussi honnête renforcé). Retente sur rate-limit (429) ET sur
 * `embedding_absent` (peut être un 429 avalé en interne sur l'embedding). Les
 * erreurs non transitoires (mauvais espace, échec dur non-429) sont fatales.
 */
async function runIndexStage(
  candidateId: string,
  deps: Deps,
  expectedSpace: string,
  maxRetries: number,
  label: string,
): Promise<IndexOutcome> {
  let lastReason = 'index:inconnu';
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const idx = await deps.indexVivierCandidate(candidateId);
    if (idx.status === 'indexed') {
      const meta = await deps.getVivierEmbeddingMeta(candidateId);
      if (meta) {
        const space = `${meta.provider}|${meta.model}`;
        if (space === expectedSpace) return { ok: true };
        return { ok: false, reason: `embedding_space_mismatch:${space}` }; // fatal
      }
      lastReason = 'embedding_absent'; // transitoire possible → on retente
    } else {
      lastReason = `index:${idx.error ?? 'inconnu'}`;
      if (!isRateLimit(idx.error)) return { ok: false, reason: lastReason }; // fatal
    }
    if (attempt <= maxRetries) {
      const wait = backoffMs(lastReason, attempt);
      console.log(
        `    ⏳ ${label} : indexation à reprendre (${lastReason.slice(0, 32)}…, essai ${attempt}/${maxRetries}) — pause ${Math.round(wait / 1000)}s`,
      );
      await sleep(wait);
    }
  }
  return { ok: false, reason: lastReason };
}

/**
 * Traite UN fichier de bout en bout. Ne lève jamais : renvoie l'état terminal.
 * `seenThisRun` déduplique les emails APPARUS pendant la run (anti-course
 * intra-lot : claim synchrone avant tout await DB).
 */
async function processFile(
  rel: string,
  opts: Options,
  deps: Deps,
  seenThisRun: Set<string>,
  expectedSpace: string,
  priorAttempts: number,
): Promise<JournalEntry> {
  const now = (): string => new Date().toISOString();
  const attempts = priorAttempts + 1;
  const done = (
    status: EntryStatus,
    extra: Partial<JournalEntry> = {},
  ): JournalEntry => ({
    status,
    email: null,
    candidateId: null,
    reason: null,
    ...extra,
    attempts,
    updatedAt: now(),
  });

  const abs = join(opts.dir, rel);
  const name = basename(rel);

  let buffer: Buffer;
  try {
    buffer = await readFile(abs);
  } catch (err) {
    return done('failed', { reason: `read:${errMsg(err)}` });
  }
  // `new Uint8Array(buffer)` : un Buffer Node (typé `Buffer<ArrayBufferLike>`)
  // n'est pas un `BlobPart` valide sous le lib strict (cas `SharedArrayBuffer`).
  // La vue Uint8Array est adossée à un ArrayBuffer concret, acceptée par File.
  const file = new File([new Uint8Array(buffer)], name, { type: mimeForExt(name) });

  // 1. Extraction du texte (pipeline existant).
  let text: string;
  try {
    const extracted = await deps.extractCVText(file);
    text = extracted.text;
  } catch (err) {
    if (err instanceof deps.CVExtractError) {
      return done('failed', { reason: `extract:${err.code}` });
    }
    return done('failed', { reason: `extract:${errMsg(err)}` });
  }

  // 2. Identité déterministe (nom + email littéral + téléphone). Appel LLM ⇒
  // reprise sur rate-limit (429). AIValidationError = permanent (pas un CV) ⇒
  // pas de retry, on classe sans email.
  let identity;
  try {
    identity = await withRateLimitRetry(name, opts.maxRetries, () =>
      deps.extractCandidateIdentity(text, name),
    );
  } catch (err) {
    if (err instanceof deps.AIValidationError) {
      return done('failed', { reason: 'identity:invalid' });
    }
    return done('failed', { reason: `identity:${errMsg(err)}` });
  }

  if (identity.isCv === false) {
    return done('skipped_no_email', { reason: 'not_a_cv' });
  }
  if (!identity.email) {
    return done('skipped_no_email', { reason: 'no_email' });
  }

  // 3. Déduplication par email (intra-run + base).
  const norm = deps.normalizeEmail(identity.email);
  if (seenThisRun.has(norm)) {
    return done('duplicate_ignored', { email: identity.email, reason: 'intra_run' });
  }
  seenThisRun.add(norm); // claim SYNCHRONE avant tout await (anti-course intra-lot)

  let existing;
  try {
    existing = await deps.getVivierCandidateByEmail(norm);
  } catch (err) {
    return done('failed', { reason: `dedup:${errMsg(err)}`, email: identity.email });
  }

  // Décision #1 (raffinée) : un doublon n'est IGNORÉ que s'il est déjà `indexed`
  // (dossier sain — on ne re-paie pas, on n'écrase pas). En revanche un dossier
  // existant mais `pending`/`failed` = NOTRE travail incomplet (échec d'indexation
  // précédent) ou un dossier creux côté app : on le RÉINDEXE sans réécrire son
  // contenu, au lieu de le sauter. Ferme le trou de reprise + répare les creux.
  if (existing && existing.indexingStatus === 'indexed') {
    return done('duplicate_ignored', {
      email: identity.email,
      candidateId: existing.id,
      reason: 'exists',
    });
  }

  // Mode simulation : on s'arrête avant toute écriture, on classe le résultat ATTENDU.
  if (opts.dryRun) {
    return done('succeeded', {
      email: identity.email,
      candidateId: existing?.id ?? null,
      reason: existing ? 'dry_run_reindex_existing' : 'dry_run',
    });
  }

  // 4. Cible d'indexation : dossier existant non-indexé (réindexation) OU nouveau
  // dossier (upsert/création). On ne réécrit jamais le contenu d'un existant.
  let candidateId: string;
  const reindexed = Boolean(existing);
  if (existing) {
    candidateId = existing.id;
  } else {
    try {
      const { candidate } = await deps.upsertVivierCandidate({
        email: identity.email,
        nom: identity.fullName,
        prenom: null,
        telephone: identity.phone,
        cvContent: buffer,
        cvFileName: name,
        cvMimeType: mimeForExt(name),
        cvText: text,
        source: 'manual_upload',
      });
      candidateId = candidate.id;
    } catch (err) {
      return done('failed', { email: identity.email, reason: `write:${errMsg(err)}` });
    }
  }

  // 5. Indexation SYNCHRONE avec reprise 429 + RÉUSSI HONNÊTE RENFORCÉ (embedding
  // titre présent dans le bon espace, sinon échec — jamais de faux « indexé »).
  const outcome = await runIndexStage(
    candidateId,
    deps,
    expectedSpace,
    opts.maxRetries,
    name,
  );
  if (outcome.ok) {
    return done('succeeded', {
      email: identity.email,
      candidateId,
      reason: reindexed ? 'reindexed_existing' : null,
    });
  }
  return done('failed', { email: identity.email, candidateId, reason: outcome.reason });
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    fail('NEXT_PUBLIC_SUPABASE_URL absent de .env.local — projet cible inconnu.');
  }
  const ref = supabaseProjectRef(supabaseUrl);
  const expectedSpace = expectedEmbeddingSpace();

  const deps = await loadDeps();

  // Scan du dossier.
  let files: string[];
  try {
    files = await scanDir(opts.dir);
  } catch (err) {
    return fail(`Dossier illisible : ${errMsg(err)}`);
  }
  if (files.length === 0) fail(`Aucun CV (.pdf/.docx/.txt/.md) trouvé dans ${opts.dir}.`);

  // CONTRÔLE PRÉ-VOL (décision #3) : refus si l'espace d'embedding existant diverge.
  let existingSpaces: string[];
  try {
    existingSpaces = await deps.listDistinctEmbeddingModels();
  } catch (err) {
    return fail(`Pré-vol impossible (lecture des modèles d'embedding) : ${errMsg(err)}`);
  }
  const divergent = existingSpaces.filter((s) => s !== expectedSpace);
  if (divergent.length > 0) {
    fail(
      `PRÉ-VOL : le vivier contient déjà l'espace « ${divergent.join(', ')} » ≠ modèle ` +
        `courant « ${expectedSpace} ». Importer mélangerait des espaces incomparables ` +
        `et casserait la présélection. Aligne OPENAI_EMBEDDING_MODEL (puis redémarre) ` +
        `ou réindexe le vivier avant l'import.`,
    );
  }

  // Journal (réel vs simulation). Le journal de simulation est distinct : la run
  // réelle n'est jamais polluée par un dry-run.
  const journalPath = join(opts.dir, opts.dryRun ? DRYRUN_JOURNAL_NAME : JOURNAL_NAME);
  const nowIso = new Date().toISOString();
  const existingJournal = await loadJournal(journalPath);

  let journal: Journal;
  if (existingJournal && !opts.dryRun) {
    // Gardes anti-contamination : même projet, même espace d'embedding.
    if (existingJournal.targetProjectRef !== ref) {
      fail(
        `Le journal existant cible le projet « ${existingJournal.targetProjectRef} » ≠ projet ` +
          `courant « ${ref} ». Refus (risque de remplir la mauvaise base).`,
      );
    }
    if (existingJournal.embeddingSpace !== expectedSpace) {
      fail(
        `Le journal a démarré sur l'espace « ${existingJournal.embeddingSpace} » ≠ courant ` +
          `« ${expectedSpace} ». Reprendre mélangerait les espaces. Réindexe ou aligne le modèle.`,
      );
    }
    journal = existingJournal;
  } else {
    // Dry-run : journal neuf à chaque fois (assessment frais de l'échantillon).
    journal = {
      version: 1,
      targetProjectRef: ref,
      embeddingSpace: expectedSpace,
      rootDir: opts.dir,
      startedAt: nowIso,
      updatedAt: nowIso,
      entries: {},
    };
  }

  // Plan de travail. En dry-run : on (re)traite tout le scan (échantillonné par --limit).
  const planned = opts.dryRun
    ? (opts.limit != null ? files.slice(0, opts.limit) : files)
    : planWork(files, journal, opts);

  // Comptage des terminaux déjà connus (run réelle), pour la bannière.
  const counts = { succeeded: 0, duplicate_ignored: 0, skipped_no_email: 0, failed: 0 };
  if (!opts.dryRun) {
    for (const e of Object.values(journal.entries)) counts[e.status]++;
  }

  // BANNIÈRE + CONFIRMATION.
  console.log('\n⚠️  IMPORT VIVIER — PROJET CIBLE');
  console.log(`   Supabase URL : ${supabaseUrl}`);
  console.log(`   Project ref  : ${ref}`);
  console.log(`   Embedding    : ${expectedSpace}`);
  console.log(`   Dossier      : ${opts.dir}   (${files.length} fichiers)`);
  console.log(
    `   À traiter    : ${planned.length}` +
      (opts.dryRun
        ? '   (SIMULATION — aucune écriture)'
        : `   (${counts.succeeded} déjà réussis, ${counts.duplicate_ignored} doublons ignorés sautés)`),
  );
  console.log(`   Mode         : ${opts.dryRun ? 'DRY-RUN (lecture seule)' : 'ÉCRITURE RÉELLE'}`);
  console.log(
    `   Cadence      : lots de ${opts.batchSize}, pause ${opts.delayMs} ms, backoff 429 × ${opts.maxRetries}`,
  );
  console.log('   Pré-vol      : ✅ espace d\'embedding cohérent');

  if (planned.length === 0) {
    console.log('\n[import-vivier] Rien à traiter — tout est déjà à jour.');
    return;
  }

  if (!opts.dryRun) {
    await confirmTarget(ref, opts);
  }

  // Reprise propre sur Ctrl-C : on s'arrête APRÈS le lot courant (déjà journalisé).
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\n[import-vivier] Arrêt demandé — fin du lot en cours puis sortie (reprise possible).');
  });

  const seenThisRun = new Set<string>();
  const run = { succeeded: 0, failed: 0, skipped_no_email: 0, duplicate_ignored: 0 };
  const batches = chunk(planned, opts.batchSize);

  console.log(
    `\n[import-vivier] ${planned.length} fichier(s) en ${batches.length} lot(s) de ` +
      `${opts.batchSize} (pause ${opts.delayMs} ms entre lots).\n`,
  );

  let processed = 0;
  for (let b = 0; b < batches.length; b++) {
    if (stopping) break;
    const batch = batches[b];
    const results = await Promise.all(
      batch.map(async (rel) => {
        const prior = journal.entries[rel]?.attempts ?? 0;
        const entry = await processFile(rel, opts, deps, seenThisRun, expectedSpace, prior);
        journal.entries[rel] = entry;
        await saveJournal(journalPath, journal); // reprise même si interruption
        return { rel, entry };
      }),
    );
    for (const { rel, entry } of results) {
      run[entry.status]++;
      processed++;
      if (entry.status === 'failed') {
        console.log(`  ✗ ${rel} — ${entry.reason}`);
      }
    }
    console.log(
      `[import-vivier] lot ${b + 1}/${batches.length} — ${processed}/${planned.length} traités ` +
        `(${run.succeeded} réussis, ${run.failed} échecs, ${run.skipped_no_email} sans email, ` +
        `${run.duplicate_ignored} doublons)`,
    );
    if (b < batches.length - 1 && !stopping) await sleep(opts.delayMs);
  }

  await journalWriteChain; // s'assurer que le dernier flush est sur disque.

  // RAPPORT FINAL.
  console.log(
    `\n[import-vivier] ${opts.dryRun ? 'SIMULATION terminée' : 'terminé'} : ` +
      `${run.succeeded} ${opts.dryRun ? 'réussiraient' : 'réussis'} · ${run.failed} échecs · ` +
      `${run.skipped_no_email} sans email · ${run.duplicate_ignored} doublons ignorés ` +
      `(sur ${processed} traités).`,
  );

  const failures = Object.entries(journal.entries).filter(([, e]) => e.status === 'failed');
  const noEmail = Object.entries(journal.entries).filter(([, e]) => e.status === 'skipped_no_email');
  if (failures.length > 0) {
    const how = opts.dryRun ? '' : ' (reprise : relance, ou --retry-failed-only)';
    console.log(`\nÉchecs${how} :`);
    for (const [rel, e] of failures) console.log(`  ✗ ${rel} — ${e.reason}`);
  }
  if (noEmail.length > 0) {
    console.log('\nSans email (inspection manuelle) :');
    for (const [rel, e] of noEmail) console.log(`  ⚠ ${rel} — ${e.reason}`);
  }
  console.log(`\nJournal : ${journalPath}`);

  if (run.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[import-vivier] échec inattendu :', err);
  process.exitCode = 1;
});
