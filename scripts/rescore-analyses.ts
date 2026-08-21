/**
 * Réparation des analyses scorées sous le veto du pré-filtre (21/08/2026).
 *
 *   npm run rescore -- --simulate                    # rapport, N'ÉCRIT RIEN
 *   npm run rescore -- --apply --only=<id>[,<id>…]
 *   npm run rescore -- --apply --replayable          # tous les dossiers ouverts
 *
 * CE QUE CE SCRIPT NE FAIT JAMAIS, quelles que soient les options :
 *   · il ne touche PAS à l'outreach — aucun mail, aucun claim, aucun brief.
 *     Même si le nouveau score passe en acceptation automatique, le dossier
 *     remonte devant un humain. Une invitation partie deux semaines après
 *     coup, sur une campagne peut-être pourvue, ferait plus de mal que le
 *     refus initial ;
 *   · il n'écrase PAS une décision humaine ni un classement sans suite. La
 *     garde est en SQL (`rescoreCandidateAnalysis`), pas ici : un script lancé
 *     à la main ne doit pas pouvoir la contourner.
 *
 * Pourquoi un chemin dédié et pas le rejeu C11 : celui-ci rejoue un CV JAMAIS
 * rattaché, depuis `imap_unmatched_cvs`. Nos analyses sont rattachées et
 * persistées — l'id `can_imap_<mailbox>_<uid>` est insert-only et le claim
 * d'outreach est posé. Un rejeu naïf ne ferait rien, ou renverrait un mail.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { extractCVText } from '@/lib/agents/cv-extract';
import {
  criteriaDecidedWithoutReading,
  potentialCeiling,
  rescoreEligibility,
} from '@/lib/scoring/rescore-selection';
import type { CVApplication } from '@/types/cv-analysis';
import type { ScoringSheet } from '@/types/scoring';

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => args.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);

const SIMULATE = has('--simulate') || !has('--apply');
const ONLY = val('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const REPLAYABLE = has('--replayable');
/** Détaille chaque verdict — sert à vérifier que les décisions sont CITÉES. */
const VERBOSE = has('--verbose');

function fail(msg: string): never {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(1);
}

type Row = {
  id: string;
  uid: string;
  campaign_id: string | null;
  candidate_name: string;
  candidate_email: string | null;
  file_name: string | null;
  total_score: number;
  decision_zone: string | null;
  decided_by: string | null;
  dismissed_at: string | null;
  application: CVApplication;
};

async function loadCvBinary(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ file: File; name: string } | null> {
  // Artefact du binaire, tel que le poller le nomme.
  const artifactId = `art_imap_cvfile_${analysisId.replace(/^can_imap_/, '')}`;
  const { data: meta } = await db
    .from('artifacts_meta')
    .select('storage_bucket, storage_path, name, mime')
    .eq('id', artifactId)
    .maybeSingle();
  if (!meta?.storage_bucket || !meta.storage_path) return null;
  const { data, error } = await db.storage
    .from(meta.storage_bucket as string)
    .download(meta.storage_path as string);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return {
    name: (meta.name as string) ?? 'cv.pdf',
    file: new File([new Uint8Array(buf)], (meta.name as string) ?? 'cv.pdf', {
      type: (meta.mime as string) || 'application/pdf',
    }),
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) fail('Creds Supabase absents.');
  const ref = new URL(url).hostname.split('.')[0] ?? '';

  if (!SIMULATE) {
    const confirm = val('--confirm-project');
    if (confirm != null) {
      if (confirm !== ref) fail(`--confirm-project="${confirm}" ≠ projet cible "${ref}".`);
    } else {
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question(
        `\n  ⚠️  RE-SCORING RÉEL sur « ${ref} ». Tape le ref pour confirmer : `,
      );
      rl.close();
      if (answer.trim() !== ref) fail('Confirmation incorrecte — abandon.');
    }
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: campaigns } = await db
    .from('campaigns')
    .select('id, name, scoring_sheet, threshold_low, threshold_high');
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id as string, c]));

  const { data: rows } = await db
    .from('candidate_analyses')
    .select('id, uid, campaign_id, candidate_name, candidate_email, file_name, total_score, decision_zone, decided_by, dismissed_at, application')
    .order('created_at', { ascending: false })
    .limit(2000);

  const touched = (rows ?? []).filter((r) => {
    const bd = (r as Row).application?.scoringResult?.breakdown ?? [];
    return criteriaDecidedWithoutReading(bd).length > 0;
  }) as Row[];

  const selected = touched.filter((r) => {
    if (ONLY) return ONLY.includes(r.id);
    if (REPLAYABLE) {
      return (
        rescoreEligibility({
          decidedBy: r.decided_by,
          dismissedAt: r.dismissed_at,
          decisionZone: r.decision_zone,
        }) === 'replayable'
      );
    }
    return true; // simulation : tout le parc touché
  });

  console.log(`\n  Projet     : ${ref}`);
  console.log(`  Mode       : ${SIMULATE ? 'SIMULATION (aucune écriture)' : 'APPLICATION'}`);
  console.log(`  Touchées   : ${touched.length}   ·   Sélectionnées : ${selected.length}\n`);
  console.log('  ' + '─'.repeat(104));
  console.log(
    `  ${'candidat'.padEnd(26)} ${'campagne'.padEnd(14)} ${'avant'.padStart(6)} ${'après'.padStart(6)} ` +
    `${'plafond'.padStart(8)} ${'zone avant'.padEnd(16)} ${'zone après'.padEnd(16)} état`,
  );
  console.log('  ' + '─'.repeat(104));

  let rescored = 0, unchanged = 0, crossed = 0, skipped = 0, noBinary = 0, failed = 0;

  for (const r of selected) {
    const eligibility = rescoreEligibility({
      decidedBy: r.decided_by,
      dismissedAt: r.dismissed_at,
      decisionZone: r.decision_zone,
    });
    const camp = campaignById.get(r.campaign_id ?? '');
    const sheet = camp?.scoring_sheet as ScoringSheet | null;
    const bd = r.application?.scoringResult?.breakdown ?? [];
    const ceiling = potentialCeiling(bd, r.total_score);
    const name = r.candidate_name.slice(0, 26).padEnd(26);
    const line = (after: string, zone: string, note: string) =>
      console.log(
        `  ${name} ${(r.campaign_id ?? '?').padEnd(14)} ${String(r.total_score).padStart(6)} ` +
        `${after.padStart(6)} ${String(ceiling).padStart(8)} ${(r.decision_zone ?? '?').padEnd(16)} ` +
        `${zone.padEnd(16)} ${note}`,
      );

    if (!sheet?.criteria?.length) {
      failed++; line('—', '—', 'fiche introuvable'); continue;
    }

    const cv = await loadCvBinary(db, r.id);
    if (!cv) {
      // Jamais un silence : un CV qu'on ne peut pas relire doit se voir.
      noBinary++; line('—', '—', '⚠ NON REJOUABLE : binaire absent'); continue;
    }

    let application: CVApplication;
    try {
      const extracted = await extractCVText(cv.file);
      const out = await analyzeCVApplication({
        cvText: extracted.text,
        fileName: extracted.fileName,
        sheet,
        source: 'email',
        receivedAt: r.application.candidate.receivedAt,
        computedAt: new Date().toISOString(),
        thresholdLow: (camp?.threshold_low as number) ?? 0,
        thresholdHigh: (camp?.threshold_high as number) ?? 100,
      });
      application = out.application;
    } catch (err) {
      failed++;
      line('—', '—', `échec : ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (VERBOSE) {
      console.log(`\n  ── ${r.candidate_name} (${r.campaign_id}) ──`);
      for (const b of application.scoringResult.breakdown) {
        console.log(
          `     [${b.criticityLevel}] ${b.criterionLabel} → ${b.llmDecision}  (par ${b.decidedBy ?? '?'})`,
        );
        if (b.llmCVQuote) console.log(`        « ${b.llmCVQuote.slice(0, 120)} »`);
        console.log(`        ${b.llmJustification.slice(0, 140)}`);
      }
      console.log('');
    }

    const after = application.scoringResult.totalScore;
    const zoneAfter = application.scoringResult.decisionZone ?? '?';
    const low = (camp?.threshold_low as number) ?? 0;
    const crossesLow = r.total_score < low && after >= low;
    if (crossesLow) crossed++;
    if (after === r.total_score) unchanged++;

    if (eligibility !== 'replayable') {
      skipped++;
      line(String(after), String(zoneAfter), `simulé seulement (${eligibility})`);
      continue;
    }
    if (SIMULATE) {
      line(String(after), String(zoneAfter), crossesLow ? '↑ franchirait le seuil' : 'simulé');
      continue;
    }

    const { rescoreCandidateAnalysis } = await import('@/lib/db/repos/candidate-analyses');
    const outcome = await rescoreCandidateAnalysis({ id: r.id, application });
    if (outcome !== 'rescored') {
      skipped++; line(String(after), String(zoneAfter), `refusé par la garde (${outcome})`);
      continue;
    }

    // La carte de validation doit montrer le score sur lequel l'humain décide.
    const { patchPendingValidationDecision } = await import('@/lib/db/repos/pending-validations');
    await patchPendingValidationDecision(`val_${r.id.replace(/^can_/, '')}_reject`, {
      score: after,
    }).catch(() => {});

    const { appendJournalEntry } = await import('@/lib/db/repos/journal');
    await appendJournalEntry({
      action: 'analysis_rescored',
      actor: 'rescore_script',
      campaignId: r.campaign_id,
      payload: {
        uid: r.uid,
        analysisId: r.id,
        candidate: r.candidate_name,
        scoreBefore: r.total_score,
        scoreAfter: after,
        zoneBefore: r.decision_zone,
        zoneAfter,
        criteriaReplayed: criteriaDecidedWithoutReading(bd).map((b) => b.criterionLabel),
        // Le re-scoring ne décide de rien et n'envoie rien : la trace le dit,
        // pour qu'aucune lecture ultérieure ne suppose le contraire.
        outreach: 'untouched',
      },
    }).catch(() => {});

    rescored++;
    line(String(after), String(zoneAfter), crossesLow ? '✓ RE-SCORÉ — franchit le seuil' : '✓ re-scoré');
  }

  console.log('  ' + '─'.repeat(104));
  console.log(`\n  re-scorées           : ${rescored}`);
  console.log(`  simulées / épargnées : ${skipped}`);
  console.log(`  franchissent le seuil bas : ${crossed}`);
  console.log(`  score inchangé       : ${unchanged}`);
  console.log(`  binaire absent       : ${noBinary}`);
  console.log(`  échecs               : ${failed}`);
  if (SIMULATE) console.log(`\n  (aucune écriture — relancer avec --apply)`);
  console.log('');
}

void main();
