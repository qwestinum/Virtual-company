/**
 * Options de `npm run vivier:import` — PUR.
 *
 * `--env` est OBLIGATOIRE, sans repli (même règle que la purge et la
 * réindexation : un fichier au nom de dev peut pointer la base du client).
 * Écrire exige `--execute` ET `--confirm-project=<ref>` : pas de question
 * interactive, la référence du projet se retape dans la commande.
 */

export type ImportOptions = {
  envPath: string;
  dir: string | null;
  zips: string[];
  datesPath: string | null;
  execute: boolean;
  confirmProject: string | null;
  concurrency: number;
  maxRetries: number;
  reportDir: string;
};

export const USAGE =
  'Usage : npm run vivier:import -- --env=<fichier> (--dir=<dossier> | --zip=<a.zip> [--zip=<b.zip>…]) ' +
  '[--dates=<fichier.csv>] [--execute --confirm-project=<ref>] [--concurrency=3] [--max-retries=6] ' +
  '[--report-dir=tmp/vivier-import]';

export const LOT_SIZE = 50;

export function parseImportArgs(argv: string[]): ImportOptions | { error: string } {
  const o: ImportOptions = {
    envPath: '',
    dir: null,
    zips: [],
    datesPath: null,
    execute: false,
    confirmProject: null,
    concurrency: 3,
    maxRetries: 6,
    reportDir: 'tmp/vivier-import',
  };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--env':
        o.envPath = value;
        break;
      case '--dir':
        if (o.dir !== null) return { error: '--dir ne se donne qu’une fois.' };
        o.dir = value;
        break;
      case '--zip':
        o.zips.push(value);
        break;
      case '--dates':
        o.datesPath = value;
        break;
      case '--execute':
        if (rest.length > 0) return { error: '--execute ne prend pas de valeur.' };
        o.execute = true;
        break;
      case '--confirm-project':
        o.confirmProject = value;
        break;
      case '--concurrency': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 10) return { error: '--concurrency : entier de 1 à 10.' };
        o.concurrency = n;
        break;
      }
      case '--max-retries': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 20) return { error: '--max-retries : entier de 0 à 20.' };
        o.maxRetries = n;
        break;
      }
      case '--report-dir':
        o.reportDir = value;
        break;
      default:
        return { error: `Option inconnue : ${arg}` };
    }
  }
  if (!o.envPath) {
    return { error: "--env=<fichier> est obligatoire. Aucun repli : l'environnement visé se nomme, il ne se devine pas." };
  }
  if (o.dir === '' || o.zips.some((z) => z === '') || o.datesPath === '' || o.reportDir === '') {
    return { error: 'Une option a été donnée sans valeur.' };
  }
  if (o.dir === null && o.zips.length === 0) return { error: 'Aucune source : --dir ou --zip.' };
  if (o.confirmProject !== null && !o.execute) {
    return { error: '--confirm-project sans --execute : rien ne serait écrit. Ajouter --execute, ou retirer la confirmation.' };
  }
  if (o.execute && !o.confirmProject) {
    return { error: '--execute exige --confirm-project=<ref> : la référence du projet visé se retape.' };
  }
  return o;
}
