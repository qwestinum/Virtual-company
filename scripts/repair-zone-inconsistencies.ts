/**
 * Réparation : incohérences de zones/analyses derrière l'écart « Refus auto »
 * Bureau vs menu Candidatures (diagnostic 26/07/2026, prod).
 *
 * Deux réparations idempotentes :
 *
 * A. Zones mal étiquetées — analyses `decided_by='user'` dont `decision_zone`
 *    n'est pas 'gray' : un humain ne tranche QUE des gris (validation suspendue),
 *    la zone a été re-dérivée du statut sur des lignes antérieures au correctif
 *    « persister decision_zone » → on re-pose la vérité `'gray'` (trace d'audit
 *    « repêché/écarté par l'humain », immuable).
 *
 * B. Validations ORPHELINES — lignes `pending_validations` (pending/sending)
 *    dont l'uid ne correspond à AUCUNE analyse : le persist best-effort de
 *    l'analyse a échoué en silence après la mise en file (corrigé côté code :
 *    persistCandidateAnalysisStrict). On RECONSTRUIT l'analyse depuis le
 *    payload de la validation (zone 'gray', statut 'rejected' provisoire,
 *    narration du payload, criteria_version marquée « reconstruit… » pour
 *    l'audit — le breakdown détaillé est perdu, pas le candidat).
 *
 * Usage :
 *   npx tsx scripts/repair-zone-inconsistencies.ts [--env .env.localX]           # dry-run
 *   npx tsx scripts/repair-zone-inconsistencies.ts [--env .env.localX] --apply   # écrit
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const envFile = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]!
  : '.env.local';
const env: Record<string, string> = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.trim();
}

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`URL/clé manquantes dans ${envFile}`);
  const projectRef = new URL(url).hostname.split('.')[0];
  console.log(`Projet cible : ${projectRef} (${envFile}) — mode ${APPLY ? 'APPLY' : 'dry-run'}`);

  if (APPLY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Confirmer en tapant le ref du projet (${projectRef}) : `);
    rl.close();
    if (answer.trim() !== projectRef) {
      throw new Error('Ref non confirmé — abandon, rien n’a été écrit.');
    }
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── A. Zones mal étiquetées ──
  const { data: mislabeled, error: aErr } = await sb
    .from('candidate_analyses')
    .select('id, uid, candidate_name, decision_zone, status, campaign_id')
    .eq('decided_by', 'user')
    .neq('decision_zone', 'gray');
  if (aErr) throw new Error(`lecture zones: ${aErr.message}`);
  console.log(`\nA. decided_by=user avec zone ≠ gray : ${mislabeled?.length ?? 0}`);
  for (const r of mislabeled ?? []) {
    if (APPLY) {
      // Conditionnel (decided_by=user) : n'écrase jamais autre chose.
      const { error } = await sb
        .from('candidate_analyses')
        .update({ decision_zone: 'gray' })
        .eq('id', r.id)
        .eq('decided_by', 'user');
      if (error) throw new Error(`update ${r.id}: ${error.message}`);
    }
    console.log(`  ✓ ${r.id} (${r.candidate_name}) ${r.decision_zone} → gray${APPLY ? '' : ' [dry-run]'}`);
  }

  // ── B. Validations orphelines ──
  const { data: pending, error: pErr } = await sb
    .from('pending_validations')
    .select('*')
    .in('status', ['pending', 'sending']);
  if (pErr) throw new Error(`lecture file: ${pErr.message}`);

  let repaired = 0;
  let skipped = 0;
  for (const v of pending ?? []) {
    const payload = (v.payload ?? {}) as Record<string, unknown>;
    const uid = typeof payload.uid === 'string' ? payload.uid : null;
    if (!uid) {
      skipped++;
      console.log(`  ✗ ${v.id} : payload sans uid — non réparable automatiquement`);
      continue;
    }
    const { count } = await sb
      .from('candidate_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('uid', uid);
    if ((count ?? 0) > 0) continue; // analyse présente — rien à faire

    const m = (v.id as string).match(/^val_imap_(.+)_(\d+)_(?:accept|reject)$/);
    if (!m) {
      skipped++;
      console.log(`  ✗ ${v.id} : id non-IMAP, reconstruction manuelle requise`);
      continue;
    }
    const analysisId = `can_imap_${m[1]}_${m[2]}`;
    const candidate = (payload.candidate ?? {}) as Record<string, unknown>;

    // Nom de fichier réel si l'artefact CV existe, repli neutre sinon.
    let fileName = 'cv.pdf';
    if (v.cv_artifact_id) {
      const { data: art } = await sb
        .from('artifacts_meta')
        .select('name')
        .eq('id', v.cv_artifact_id)
        .maybeSingle();
      if (art?.name) fileName = art.name as string;
    }

    const receivedAt = v.created_at as string;
    const score = typeof v.score === 'number' ? v.score : Number(candidate.score ?? 0);
    const strArr = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
    // Reconstruction honnête : mêmes formes que CVApplication ; le breakdown
    // détaillé n'est pas récupérable → criteria_version le SIGNALE à l'audit.
    const application = {
      candidate: {
        fullName: v.candidate_name,
        email: v.candidate_email ?? null,
        phone: typeof candidate.phone === 'string' ? candidate.phone : null,
        detectedLanguage: null,
        fileName,
        source: 'email',
        receivedAt,
        rightToWork: null,
        location: null,
        photoPresent: false,
      },
      scoringResult: {
        totalScore: score,
        status: 'rejected', // provisoire — la vérité du gris est decisionZone
        decisionZone: 'gray',
        breakdown: [],
        hardFailures: [],
        criteriaVersion: 'reconstruit-validation-orpheline-2026-07',
        computedAt: receivedAt,
      },
      narration: {
        summary: String(candidate.summary ?? payload.summary ?? 'Analyse reconstruite depuis la validation en attente.'),
        strengths: strArr(candidate.strengths),
        weaknesses: strArr(candidate.weaknesses),
        justification: String(candidate.justification ?? 'Détail du scoring perdu (analyse non persistée à la réception) — reconstruit depuis la file de validation.'),
      },
    };

    if (APPLY) {
      const { error } = await sb.from('candidate_analyses').insert({
        id: analysisId,
        uid,
        campaign_id: v.campaign_id,
        candidate_name: v.candidate_name,
        candidate_email: v.candidate_email,
        file_name: fileName,
        source: 'email',
        received_at: receivedAt,
        total_score: score,
        status: 'rejected',
        criteria_version: 'reconstruit-validation-orpheline-2026-07',
        computed_at: receivedAt,
        application,
        hitl_config: { rejectionMail: true, acceptanceMail: true },
        decision_zone: 'gray',
        decided_by: 'auto',
        decided_by_user_id: null,
        decided_by_user_email: null,
      });
      if (error) throw new Error(`insert ${analysisId}: ${error.message}`);
    }
    repaired++;
    console.log(`  ✓ ${v.id} (${v.candidate_name}) → analyse ${analysisId} reconstruite${APPLY ? '' : ' [dry-run]'}`);
  }
  console.log(`\nB. orphelines ${APPLY ? 'réparées' : 'réparables'} : ${repaired}, non réparables auto : ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
