/**
 * Déménagement des propositions vivier en attente (refonte, lot 4).
 *
 * La file « Validations vivier » disparaît. Les propositions qui y attendaient
 * réapparaissent dans la recherche vivier de leur campagne ; ce script en pose
 * la TRACE au journal. Il ne modifie AUCUNE proposition et n'envoie rien.
 *
 *   npx tsx scripts/relocate-vivier-proposals.ts --env=.env.local
 *   npx tsx scripts/relocate-vivier-proposals.ts --env=.env.local --execute --confirm-project=<ref>
 *
 * Deux gardes, reprises de `purge:candidate` :
 *   `--env` OBLIGATOIRE, aucun repli — plusieurs fichiers d'environnement
 *   coexistent ici et l'un d'eux porte un nom de dev en pointant la base
 *   client. Ne pas choisir reviendrait à laisser le hasard choisir.
 *   `--confirm-project` doit égaler la référence du projet visé : on la
 *   recopie après l'avoir LUE dans le constat.
 *
 * Sans `--execute`, rien ne s'écrit : le constat est le mode par défaut.
 */
import { config } from 'dotenv';

function arg(nom: string): string | null {
  const prefixe = `--${nom}=`;
  const trouve = process.argv.find((a) => a.startsWith(prefixe));
  return trouve ? trouve.slice(prefixe.length) : null;
}

async function main(): Promise<void> {
  const env = arg('env');
  if (!env) {
    console.error(
      'ERREUR : --env est obligatoire (ex. --env=.env.local). Aucun repli :\n' +
        'plusieurs fichiers coexistent, et l’un porte un nom de dev en pointant la base client.',
    );
    process.exit(1);
  }
  config({ path: env });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? '(inconnue)';

  const execute = process.argv.includes('--execute');
  const confirme = arg('confirm-project');

  const { relocateVivierProposals } = await import('@/lib/vivier/relocation');

  console.log(`\nProjet visé : ${ref}`);
  console.log(`Mode        : ${execute ? 'ÉCRITURE' : 'constat (aucune écriture)'}\n`);

  if (execute && confirme !== ref) {
    console.error(
      `ERREUR : --confirm-project doit valoir « ${ref} ».\n` +
        'Recopiez-la après l’avoir lue dans un constat.',
    );
    process.exit(1);
  }

  const { plan, written, failed } = await relocateVivierProposals({ execute });

  const ligne = (titre: string, groupes: typeof plan.toNote) => {
    const total = groupes.reduce((n, g) => n + g.count, 0);
    console.log(`${titre} : ${total} proposition(s) sur ${groupes.length} campagne(s)`);
    for (const g of groupes) {
      console.log(`    ${g.campaignId}  ${String(g.count).padStart(3)}  depuis le ${g.oldestGeneratedAt.slice(0, 10)}`);
    }
  };

  ligne('À déménager        ', plan.toNote);
  ligne('Déjà déménagées    ', plan.alreadyNoted);
  if (plan.stranded.length > 0) {
    console.log('');
    ligne('⚠️  SANS DESTINATION', plan.stranded);
    console.log(
      '    Leur campagne est clôturée (ou introuvable) : sa recherche vivier\n' +
        '    ne s’ouvre pas. Elles ne sont PAS déclarées déménagées — un humain\n' +
        '    doit décider de leur sort avant que la file ne soit retirée.',
    );
  }

  if (execute) {
    console.log(`\nNotes écrites : ${written}${failed > 0 ? ` · échecs : ${failed}` : ''}`);
  } else {
    console.log('\nConstat seul. Ajoutez --execute --confirm-project=<ref> pour écrire.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('ÉCHEC :', (e as Error).message);
    process.exit(1);
  });
