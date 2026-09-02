/**
 * Effacement des données d'un candidat (RGPD, article 17).
 * Procédure de référence : docs/ops/purge-rgpd-candidat.md
 *
 *   # Constat — n'écrit RIEN. À faire sur CHAQUE environnement.
 *   npm run purge:candidate -- --env .env.localX --email jean.dupont@exemple.fr
 *
 *   # Exécution.
 *   npm run purge:candidate -- --env .env.localX --email jean.dupont@exemple.fr \
 *       --execute --confirm-project <ref> --request-ref "courriel DRH du 27/08/2026" \
 *       --report rapport-effacement.md
 *
 * CE QUE CE SCRIPT NE FAIT JAMAIS :
 *   · il n'écrit rien sans `--execute` — le constat est le mode par défaut ;
 *   · il ne devine aucune adresse (variantes, alias) : supposer que deux
 *     adresses sont la même personne ferait effacer les données d'un tiers ;
 *   · il ne cible JAMAIS sur le nom seul — un homonyme n'est pas une cible ;
 *   · il ne passe pas outre un engagement en cours (entretien programmé,
 *     rendez-vous réservé) : c'est l'arbitrage du responsable de traitement,
 *     et aucune option ne l'escamote.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { collectBlockerFacts } from '@/lib/gdpr/blocker-facts';
import { detectBlockers, needsHumanDecision } from '@/lib/gdpr/blockers';
import { executeErasure } from '@/lib/gdpr/execute';
import { erasureMarker } from '@/lib/gdpr/marker';
import { buildFingerprint } from '@/lib/gdpr/payload-pseudonymize';
import {
  assertNoLeakedIdentity,
  renderErasureReport,
  ReportLeakError,
} from '@/lib/gdpr/report';
import {
  MissingPepperError,
  previousExecutions,
  recordErasureRequest,
  subjectHash,
} from '@/lib/gdpr/requests';
import { resolveIdentity } from '@/lib/gdpr/resolve';
import { planStorage } from '@/lib/gdpr/storage-plan';
import { verifyErasure } from '@/lib/gdpr/verify';
import { perimeterSize } from '@/lib/gdpr/perimeter';
import type { ErasureCounts, VerificationStatus, VerifyOutcome } from '@/types/gdpr';

// ─── Arguments ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const one = (flag: string): string | null => {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : null;
};
const many = (flag: string): string[] =>
  argv
    .map((a, i) =>
      a.startsWith(`${flag}=`)
        ? a.slice(flag.length + 1)
        : a === flag && argv[i + 1] && !argv[i + 1]!.startsWith('--')
          ? argv[i + 1]!
          : null,
    )
    .filter((v): v is string => v !== null);

function fail(msg: string): never {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(1);
}

// ─── Environnement — explicite, jamais de repli ────────────────────────────

/**
 * `--env` est OBLIGATOIRE et le fichier fait AUTORITÉ sur les variables déjà
 * présentes dans le shell. Un repli automatique sur `.env.local` conduirait à
 * purger l'environnement de développement en croyant purger la production, ou
 * l'inverse. Et une variable oubliée dans un shell ne doit pas pouvoir
 * détourner la cible d'une commande dont c'est tout l'objet de la nommer.
 *
 * ⚠️ Piège documenté : le fichier `.env.dev.local` porte un nom de
 * développement mais pointe la base du CLIENT. C'est pourquoi l'outil imprime
 * toujours la référence du projet RÉELLEMENT visé, et la fait retaper.
 */
function loadEnvFile(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    return fail(`Fichier d'environnement introuvable : ${path}`);
  }
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/gu, '');
  }
  return out;
}

// ─── Programme ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const envPath = one('--env');
  if (!envPath) {
    fail(
      '--env est obligatoire (ex. --env .env.local). Aucun repli automatique : ' +
        "l'environnement visé se nomme, il ne se devine pas.",
    );
  }
  const env = loadEnvFile(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) fail(`Identifiants Supabase absents de ${envPath}.`);
  const ref = new URL(url).hostname.split('.')[0] ?? '';

  const emails = [...many('--email'), ...many('--also-email')].map((e) => e.trim().toLowerCase());
  const analysisIds = many('--analysis-id');
  const imapRefs = many('--uid').map((v) => {
    const at = v.lastIndexOf(':');
    if (at < 0) fail(`--uid attend « <boîte>:<numéro> », reçu « ${v} ».`);
    return { mailboxId: v.slice(0, at), uid: v.slice(at + 1) };
  });
  if (emails.length === 0 && analysisIds.length === 0 && imapRefs.length === 0) {
    fail('Rien à chercher : donnez au moins --email, --analysis-id ou --uid.');
  }

  const execute = has('--execute');
  const purgeAnalyses = has('--purge-analyses');
  const deepScan = has('--deep-storage-scan');
  const requestRef = one('--request-ref') ?? '';
  const receivedAt = one('--received-at');
  const instructedBy = one('--instructed-by');
  const reason = one('--reason');
  const reportPath = one('--report');
  const backupDaysRaw = one('--backup-days');
  const backupRetentionDays = backupDaysRaw ? Number(backupDaysRaw) : null;
  const operator = one('--operator') ?? process.env.USER ?? 'opérateur non identifié';

  console.log(`\n  Projet ciblé : ${ref}   (${envPath})`);
  console.log(`  Mode         : ${execute ? '⚠️  EXÉCUTION' : 'constat (aucune écriture)'}`);
  console.log(`  Adresses     : ${emails.join(', ') || '—'}`);

  if (execute) {
    if (!requestRef) {
      fail(
        '--request-ref est obligatoire en exécution : la référence de ' +
          "l'instruction écrite du responsable de traitement est la base légale " +
          'de cet effacement, et la clé de sa preuve.',
      );
    }
    const confirm = one('--confirm-project');
    if (confirm !== null) {
      if (confirm !== ref) fail(`--confirm-project « ${confirm} » ≠ projet ciblé « ${ref} ».`);
    } else {
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question(
        `\n  ⚠️  EFFACEMENT RÉEL ET IRRÉVERSIBLE sur « ${ref} ».\n` +
          `      Tapez la référence du projet pour confirmer : `,
      );
      rl.close();
      if (answer.trim() !== ref) fail('Confirmation incorrecte — abandon.');
    }
  }

  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  const marker = erasureMarker(requestRef || 'référence non précisée');

  // ── 1. Résolution ───────────────────────────────────────────────────────
  const identity = await resolveIdentity(db, { emails, analysisIds, imapRefs });
  const fingerprint = buildFingerprint({
    emails: identity.emails,
    names: identity.names,
    phones: identity.phones,
  });

  console.log('\n  ── Ce qui a été retrouvé ────────────────────────────────');
  console.log(`  analyses de candidature ....... ${identity.analysisIds.length}`);
  console.log(`  dossiers en attente ........... ${identity.validationIds.length}`);
  console.log(`  briefings d'entretien ......... ${identity.briefIds.length}`);
  console.log(`  dossiers de vivier ............ ${identity.vivierIds.length}`);
  console.log(`  liens de réservation .......... ${identity.linkTokens.length}`);
  console.log(`  rendez-vous ................... ${identity.bookingIds.length}`);
  console.log(`  références de documents ....... ${identity.artifactIds.length}`);
  console.log(`  entrées de file de réception .. ${identity.unmatchedIds.length}`);
  console.log(`  campagnes concernées .......... ${identity.campaignIds.join(', ') || '—'}`);
  if (identity.names.length > 0) {
    console.log(`  noms rencontrés (caviardage) .. ${identity.names.join(' · ')}`);
  }
  if (perimeterSize(identity) === 0) {
    console.log(
      '\n  Périmètre VIDE : rien de rattachable à cette personne ici. Le\n' +
        '  contrôle final restera sans objet — il ne peut pas vérifier ce\n' +
        '  qu’il ne retrouve plus.',
    );
  }

  // Une exécution antérieure sur cette personne ? On le dit AVANT d'agir : un
  // constat qui ne trouve rien peut vouloir dire « rien à effacer » ou « déjà
  // effacé », et ce n'est pas la même conversation avec le client.
  const pepper = env.GDPR_SUBJECT_PEPPER ?? process.env.GDPR_SUBJECT_PEPPER;
  if (pepper && emails[0]) {
    const past = await previousExecutions(db, subjectHash(emails[0], pepper));
    if (past.length > 0) {
      console.log('\n  ── Exécutions antérieures ───────────────────────────────');
      for (const p of past) {
        console.log(`  ${p.executedAt ?? '?'} · ${p.environment} · ${p.requestRef}`);
      }
    }
  }

  // ── 2. Arrêts — AVANT toute écriture ────────────────────────────────────
  const blockers = detectBlockers(await collectBlockerFacts(db, identity));
  if (blockers.length > 0) {
    console.log('\n  ── Effacement suspendu ──────────────────────────────────');
    for (const b of blockers) {
      console.log(`\n  ${needsHumanDecision(b) ? '⛔' : '⏳'} ${b.message}`);
      console.log(`     (repère technique : ${b.ref})`);
    }
    console.log(
      '\n  Aucune donnée n’a été modifiée. Levez la cause, puis relancez la ' +
        'même commande.\n',
    );
    process.exit(2);
  }

  // ── 3. Plan sur le stockage ─────────────────────────────────────────────
  const plan = await planStorage(db, identity, fingerprint, { deepScan });
  const byAction = (a: string) => plan.targets.filter((t) => t.action === a);
  console.log('\n  ── Fichiers ─────────────────────────────────────────────');
  console.log(`  à supprimer ................... ${byAction('delete').length}`);
  console.log(`  à réécrire (rapports groupés) . ${byAction('rewrite').length}`);
  console.log(`  à vérifier (homonyme ?) ....... ${byAction('review').length}`);
  console.log(`  laissés en place .............. ${byAction('keep').length}`);
  for (const t of byAction('review')) console.log(`     ⚠️  ${t.path} — ${t.why}`);
  if (plan.truncated) {
    console.log(
      `  ⚠️  Parcours BORNÉ : ${plan.notInspected.length} fichier(s) texte non ` +
        'inspecté(s). Relancez avec --deep-storage-scan, ou traitez-les à la main.',
    );
  }

  // ── 4. Exécution ────────────────────────────────────────────────────────
  const result = await executeErasure({
    db,
    identity,
    fingerprint,
    marker,
    storage: plan.targets,
    purgeAnalyses,
    dryRun: !execute,
    actor: operator,
  });

  if (result.stoppedAt) {
    console.error(
      `\n  ❌ Arrêt à l'étape « ${result.stoppedAt} » : ${result.error}\n` +
        `     Les étapes précédentes ONT été appliquées et sont rejouables sans ` +
        `risque.\n     Corrigez la cause, puis relancez la même commande.\n`,
    );
    await persistTrace(db, {
      requestRef,
      emails,
      env,
      ref,
      status: 'partial',
      receivedAt,
      instructedBy,
      operator,
      reason,
      counts: result.counts,
      already: result.alreadyErased,
      execute,
    });
    process.exit(1);
  }

  printCounts(execute ? 'Effacé' : 'À effacer', result.counts);
  if (sum(result.alreadyErased) > 0) printCounts('Déjà effacé', result.alreadyErased);

  // ── 5. Contrôle final ───────────────────────────────────────────────────
  // ⚠️ Le contrôle ne lit QUE le périmètre de la demande. Périmètre vide ⇒ il
  //    ne s'exécute pas : sans identifiant, une recherche n'a plus de terme et
  //    rend la base entière (incident du 02/09/2026, §7.4 de la procédure).
  let verification: VerificationStatus = 'not_run';
  let outcome: VerifyOutcome | null = null;
  if (execute) {
    outcome = await verifyErasure(db, identity, fingerprint);
    verification = outcome.status;
    console.log('\n  ── Contrôle ─────────────────────────────────────────────');
    if (outcome.status === 'not_run') {
      console.log(
        '  Sans objet : aucune donnée n’a été retrouvée pour cette personne\n' +
          '  dans cet environnement, il n’y a donc rien à contrôler. C’est le\n' +
          '  résultat attendu d’un rejeu sur un périmètre déjà effacé.',
      );
    } else {
      console.log(`  lignes du périmètre auditées .. ${outcome.auditedRows}`);
      console.log(`  résidus nominatifs ............ ${outcome.residues.length}`);
      console.log(`  chemins de ré-identification .. ${outcome.reidentification.length}`);
      console.log(
        `  homonymes probables ........... ${outcome.homonymWarnings.length}` +
          (outcome.homonymsTruncated ? ' (liste tronquée)' : ''),
      );
      for (const r of outcome.residues) {
        console.log(`     ❌ ${r.location} · ${r.field} — ${r.trigger} : ${r.sample}`);
      }
      for (const r of outcome.reidentification) {
        console.log(`     ❌ ${r.path} → ${r.location} : ${r.evidence}`);
      }
      // Ces lignes appartiennent à des TIERS : on donne l'emplacement pour
      // qu'un humain aille voir, jamais la valeur qu'on y a lue.
      for (const w of outcome.homonymWarnings.slice(0, 20)) {
        console.log(`     ⚠️  ${w.location} · ${w.field} (homonyme probable — intact)`);
      }
      if (outcome.homonymsTruncated) {
        console.log('     ⚠️  Liste bornée : d’autres homonymes existent probablement.');
      }
    }
    if (outcome.status === 'residues') {
      console.error(
        '\n  ❌ EFFACEMENT INCOMPLET : le contrôle a retrouvé des traces. ' +
          'Ne transmettez pas de rapport de confirmation en l’état.\n',
      );
    }
  }

  // ── 6. Trace + rapport ──────────────────────────────────────────────────
  const traced = await persistTrace(db, {
    requestRef,
    emails,
    env,
    ref,
    status: execute ? 'executed' : 'dry_run',
    receivedAt,
    instructedBy,
    operator,
    reason,
    counts: result.counts,
    already: result.alreadyErased,
    execute,
  });
  if (execute && !traced) {
    console.log(
      "\n  ⚠️  La table `gdpr_erasure_requests` n'existe pas sur cet " +
        "environnement : l'effacement a eu lieu, sa trace n'a pas pu être " +
        'enregistrée. Appliquez la migration, puis relancez pour la poser.',
    );
  }

  const report = renderErasureReport({
    requestRef: requestRef || '(référence non précisée — constat)',
    receivedAt,
    executedAt: new Date().toISOString(),
    environmentLabel: `environnement ${ref}`,
    counts: result.counts,
    alreadyErased: result.alreadyErased,
    storage: plan.targets,
    purgedAnalyses: purgeAnalyses,
    backupRetentionDays: Number.isFinite(backupRetentionDays)
      ? (backupRetentionDays as number)
      : null,
    dryRun: !execute,
    verification,
  });

  // GARDE DURE — un rapport d'effacement ne porte que des compteurs. On lui
  // interdit toute valeur lue en base : les identités du sujet, et CHAQUE
  // extrait relevé par le contrôle (qui pourrait appartenir à un tiers). En
  // cas de doute on n'écrit RIEN : un fichier qu'on peut transmettre par
  // erreur est pire qu'un rapport manquant, qu'on régénère en une commande.
  try {
    assertNoLeakedIdentity(report, [
      ...emails,
      ...identity.emails,
      ...identity.names,
      ...identity.phones,
      ...(outcome?.residues.map((r) => r.sample) ?? []),
      ...(outcome?.reidentification.map((r) => r.evidence) ?? []),
    ], [requestRef]);
  } catch (err) {
    if (err instanceof ReportLeakError) {
      fail(
        `${err.message}\n     L'effacement, lui, a bien eu lieu — seul le ` +
          "document n'a pas été produit. Signalez ce message : c'est un défaut " +
          "de l'outil, pas de la demande.",
      );
    }
    throw err;
  }

  // La référence de la demande est recopiée telle quelle dans le rapport. Si
  // le responsable de traitement l'a formulée avec le nom de la personne, le
  // document le portera — c'est SA phrase, et le rapport lui revient, mais il
  // faut qu'il le sache avant de le relayer au candidat.
  if (identity.names.some((n) => n.length >= 5 && requestRef.toLowerCase().includes(n.toLowerCase()))) {
    console.log(
      '\n  ⚠️  La référence de la demande contient le nom de la personne : le\n' +
        '      rapport le portera donc. Utilisez une référence neutre (numéro de\n' +
        '      dossier, date) si le document doit circuler.',
    );
  }

  if (reportPath) {
    writeFileSync(resolve(process.cwd(), reportPath), report, 'utf8');
    console.log(`\n  📄 Rapport écrit : ${reportPath}`);
  } else {
    console.log(`\n${report}`);
  }

  if (!execute) {
    console.log(
      '\n  Constat seulement — aucune donnée modifiée. Ajoutez --execute ' +
        '--confirm-project ' +
        ref +
        ' --request-ref "…" pour appliquer.\n',
    );
  }
}

// ─── Trace ─────────────────────────────────────────────────────────────────

async function persistTrace(
  db: SupabaseClient,
  args: {
    requestRef: string;
    emails: string[];
    env: Record<string, string>;
    ref: string;
    status: 'dry_run' | 'executed' | 'partial';
    receivedAt: string | null;
    instructedBy: string | null;
    operator: string;
    reason: string | null;
    counts: ErasureCounts;
    already: ErasureCounts;
    execute: boolean;
  },
): Promise<boolean> {
  if (!args.execute) return true; // un constat ne laisse pas de trace d'exécution
  const pepper = args.env.GDPR_SUBJECT_PEPPER ?? process.env.GDPR_SUBJECT_PEPPER;
  let hash: string;
  try {
    hash = subjectHash(args.emails[0] ?? args.requestRef, pepper);
  } catch (err) {
    if (err instanceof MissingPepperError) fail(err.message);
    throw err;
  }

  const written = await recordErasureRequest(db, {
    requestRef: args.requestRef,
    subjectHash: hash,
    environment: args.ref,
    status: args.status,
    receivedAt: args.receivedAt,
    instructedBy: args.instructedBy,
    executedBy: args.operator,
    reason: args.reason,
    counts: args.counts,
    alreadyErased: args.already,
  });

  // Entrée de journal SANS identité — la preuve d'exécution, pas son objet.
  // Insert DIRECT sur le client injecté : le repo `appendJournalEntry` lit la
  // configuration dans `process.env`, que `--env` ne renseigne délibérément
  // pas (nommer l'environnement ne doit pas revenir à le rendre implicite
  // partout ailleurs dans le processus).
  const { error } = await db.from('journal').insert({
    action: 'gdpr_erasure_executed',
    actor: 'gdpr_purge',
    campaign_id: null,
    payload: {
      requestRef: args.requestRef,
      environment: args.ref,
      status: args.status,
      counts: { ...args.counts },
      alreadyErased: { ...args.already },
      traceRecorded: written,
    },
  });
  if (error) {
    // Un échec ici n'annule pas l'effacement : il prive d'une ligne de trace.
    // On le DIT plutôt que de laisser croire à une traçabilité complète.
    console.log(`  ⚠️  Entrée de journal « gdpr_erasure_executed » non écrite : ${error.message}`);
  }
  return written;
}

function printCounts(title: string, c: ErasureCounts): void {
  console.log(`\n  ── ${title} ──────────────────────────────────────────────`);
  const labels: Record<keyof ErasureCounts, string> = {
    analyses: 'analyses de candidature',
    validations: 'dossiers en attente de décision',
    interviewBriefs: "briefings d'entretien",
    vivierDossiers: 'dossiers de vivier',
    bookingLinks: 'liens de réservation',
    bookings: 'rendez-vous',
    artifactRows: 'références de documents',
    storageFilesDeleted: 'fichiers supprimés',
    storageFilesRewritten: 'rapports groupés réécrits',
    unmatchedRows: 'entrées de file de réception',
    retryRows: "compteurs de réessai assainis",
    journalEntries: 'entrées de journal pseudonymisées',
  };
  for (const [k, label] of Object.entries(labels) as [keyof ErasureCounts, string][]) {
    if (c[k] > 0) console.log(`  ${label.padEnd(34, '.')} ${c[k]}`);
  }
  if (sum(c) === 0) console.log('  (rien)');
}

function sum(c: ErasureCounts): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}

void (async () => {
  try {
    await main();
  } catch (err) {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
})();
