/**
 * Nettoyage ciblé du jobboard de démonstration.
 *
 *   npm run reset:demo-jobboard                          # interactif
 *   npm run reset:demo-jobboard -- --confirm-project=<ref>
 *
 * PÉRIMÈTRE VOLONTAIREMENT ÉTROIT : ce script supprime les ANNONCES
 * (`demo_job_posts`) et rien d'autre. Il ne touche NI aux campagnes, NI aux
 * candidatures qu'elles ont produites — parce que depuis le passage au
 * transport réel, une candidature issue du jobboard est un mail ordinaire :
 * elle a suivi le même chemin qu'une candidature spontanée et rien ne la
 * distingue en base. La supprimer « parce qu'elle vient de la démo »
 * demanderait de deviner, et l'effacement d'une candidature réelle est
 * irrattrapable. Les campagnes de démonstration se ferment par la clôture
 * normale, qui sait déjà quoi faire des dossiers en cours.
 *
 * Garde-fou projet identique à `seed:volume` : on écrit sur une vraie base, on
 * confirme laquelle.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

loadEnvConfig(process.cwd());

function fail(message: string): never {
  console.error(`\n  ❌ ${message}\n`);
  process.exit(1);
}

function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');

  const ref = projectRef(url);
  const confirmArg = process.argv
    .find((a) => a.startsWith('--confirm-project='))
    ?.split('=')[1];

  if (confirmArg != null) {
    if (confirmArg.trim() !== ref) {
      fail(`--confirm-project="${confirmArg}" ≠ projet cible "${ref}".`);
    }
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\n  ⚠️  Suppression des annonces du jobboard sur « ${ref} ». Tape le ref pour confirmer : `,
    );
    rl.close();
    if (answer.trim() !== ref) fail('Confirmation du projet incorrecte — abandon.');
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from('demo_job_posts')
    .delete()
    .neq('campaign_id', '')
    .select('campaign_id');
  if (error) fail(`Suppression impossible : ${error.message}`);

  const removed = data ?? [];
  console.log(
    `\n  ✅ ${removed.length} annonce${removed.length > 1 ? 's' : ''} supprimée${
      removed.length > 1 ? 's' : ''
    } sur « ${ref} ».`,
  );
  for (const row of removed) console.log(`     · ${row.campaign_id}`);
  console.log(
    '\n  ℹ️  Les candidatures déjà reçues ne sont PAS touchées : elles sont arrivées\n' +
      '     par la boîte mail comme n’importe quelle candidature. Passe par la\n' +
      '     clôture de campagne pour les traiter.\n',
  );
}

void main();
