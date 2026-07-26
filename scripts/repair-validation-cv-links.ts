/**
 * Réparation : re-lie le CV aux validations suspendues qui l'ont perdu.
 *
 * Incident 07/2026 — les re-passes du poller IMAP (retries, re-analyses en
 * boucle) écrasaient `pending_validations.cv_artifact_id` avec null alors que
 * l'artefact CV (`art_imap_cvfile_<mailbox>_<uid>`) existait bel et bien en
 * base (posé par la première passe ; l'INSERT des passes suivantes échouait en
 * doublon → catch best-effort → null → upsert destructif). Corrigé côté code
 * (upsertArtifactMeta + mergePendingValidationEnqueue) ; ce script répare le
 * stock existant.
 *
 * Pour chaque validation `pending`/`sending` sans cv_artifact_id dont l'id
 * suit le motif `val_imap_<mailboxId>_<uid>_<decision>` : si l'artefact
 * `art_imap_cvfile_<mailboxId>_<uid>` existe, on re-pose le lien. Idempotent
 * (re-exécutable), conditionnel (n'écrase jamais un lien non-null).
 *
 * Usage :
 *   npx tsx scripts/repair-validation-cv-links.ts            # dry-run
 *   npx tsx scripts/repair-validation-cv-links.ts -- --apply # écrit
 */
import { createInterface } from 'node:readline/promises';

import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

loadEnvConfig(process.cwd());

const APPLY = process.argv.includes('--apply');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
  }
  const projectRef = new URL(url).hostname.split('.')[0];
  console.log(`Projet cible : ${projectRef} — mode ${APPLY ? 'APPLY' : 'dry-run'}`);

  if (APPLY) {
    // Garde anti-mauvais-projet (même réflexe que import:vivier) : on confirme
    // la cible en tapant son ref — .env.local vs .env.localX (prod client).
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Confirmer en tapant le ref du projet (${projectRef}) : `);
    rl.close();
    if (answer.trim() !== projectRef) {
      throw new Error('Ref non confirmé — abandon, rien n’a été écrit.');
    }
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: vals, error } = await sb
    .from('pending_validations')
    .select('id, candidate_name, campaign_id, status, cv_artifact_id')
    .in('status', ['pending', 'sending'])
    .is('cv_artifact_id', null);
  if (error) throw new Error(`lecture pending_validations: ${error.message}`);

  let repaired = 0;
  let unrepairable = 0;
  for (const v of vals ?? []) {
    const m = v.id.match(/^val_imap_(.+)_(\d+)_(?:accept|reject)$/);
    if (!m) {
      console.log(`— ${v.id} (${v.candidate_name}) : id non-IMAP, ignoré`);
      continue;
    }
    const artId = `art_imap_cvfile_${m[1]}_${m[2]}`;
    const { data: art, error: artErr } = await sb
      .from('artifacts_meta')
      .select('id, storage_path')
      .eq('id', artId)
      .maybeSingle();
    if (artErr) throw new Error(`lecture artifacts_meta: ${artErr.message}`);
    if (!art) {
      unrepairable++;
      console.log(
        `✗ ${v.id} (${v.candidate_name}) : artefact ${artId} absent — irréparable ici (binaire jamais persisté, cf. MIME bucket)`,
      );
      continue;
    }
    if (APPLY) {
      // Conditionnel sur cv_artifact_id null : si une passe concurrente a déjà
      // reposé le lien entre la lecture et maintenant, on ne touche pas.
      const { error: upErr } = await sb
        .from('pending_validations')
        .update({ cv_artifact_id: artId })
        .eq('id', v.id)
        .is('cv_artifact_id', null);
      if (upErr) throw new Error(`update ${v.id}: ${upErr.message}`);
    }
    repaired++;
    console.log(`✓ ${v.id} (${v.candidate_name}) → ${artId}${APPLY ? '' : ' [dry-run]'}`);
  }

  console.log(
    `\n${repaired} lien(s) CV ${APPLY ? 'réparé(s)' : 'réparable(s)'}, ${unrepairable} irréparable(s) sur ${vals?.length ?? 0} validation(s) sans CV.`,
  );
  if (!APPLY && repaired > 0) {
    console.log('Relancer avec --apply pour écrire.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
