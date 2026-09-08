/**
 * Calcul de la clé d'authentification ADEP (`atsPassword`).
 *
 *   npm run adep:hash -- --env .env.adep          # calcule et affiche la clé
 *   npm run adep:hash -- --cross-check            # croise Node et Python
 *   npm run adep:hash -- --env .env.adep --cross-check
 *
 * ── POURQUOI UN SCRIPT, ET PAS L'APPLICATION ────────────────────────────────
 *
 * La clé est CONSTANTE pour un triplet (mot de passe, sel, paramètres). Elle se
 * calcule une fois, se pose dans `ADEP_ATS_PASSWORD_HASH`, et la production ne
 * hache plus jamais rien — donc n'embarque aucune dépendance native.
 * `@node-rs/argon2` reste une devDependency.
 *
 * ── LE CROISEMENT, ET CE QU'IL PROUVE ───────────────────────────────────────
 *
 * Il n'existe AUCUN vecteur de test officiel. La documentation donne deux bouts
 * de code (Java, Python) mais jamais un couple (mot de passe, sel) → clé
 * attendue. Le seul `atsPassword` littéral de la spec fait 128 caractères
 * hexadécimaux : c'est un reliquat SHA-512 de la V4, comme les placeholders
 * `PASSWORD_SHA_512` des exemples de flux.
 *
 * `--cross-check` fait donc la seule chose vérifiable hors ligne : calculer la
 * même clé avec DEUX implémentations indépendantes — la nôtre (Rust, via
 * `@node-rs/argon2`) et `argon2-cffi` (la bibliothèque C de référence, via
 * Python), qui est précisément celle dont la spec donne le code. Si elles
 * concordent, notre paramétrage (256 octets, base64 sans padding, sel décodé,
 * mémoire 4096, version 19) est conforme à ce que la spec DÉCRIT. Cela ne
 * prouve pas que l'Apec attend cela — seul l'appel réel le dira, et une clé
 * fausse y rend `API_102_ATS_PASSWORD_INVALID_ERROR`, qui est un diagnostic
 * net.
 *
 * ── AUCUN SECRET N'EST AFFICHÉ EN CLAIR PAR DÉFAUT ──────────────────────────
 *
 * La clé est un secret. On affiche sa longueur et son empreinte ; `--reveal`
 * l'écrit en entier, pour la recopier dans le gestionnaire de secrets. Le mot
 * de passe, lui, n'est jamais affiché.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

import {
  ARGON2_EXPECTED_KEY_LENGTH,
  ARGON2_HASH_LENGTH_BYTES,
  ARGON2_MEMORY_KIB,
  ARGON2_VERSION,
  computeAtsPassword,
} from '../src/lib/jobboards/adep/argon2';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const val = (flag: string) =>
  args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1) ??
  (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

function fail(message: string): never {
  console.error(`\n  ❌ ${message}\n`);
  process.exit(1);
}

/** Empreinte courte — identifie une clé sans la divulguer. */
function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Calcule la même clé avec `argon2-cffi`. Rend `null` si Python ou la
 * bibliothèque manquent — c'est un cas ORDINAIRE (le croisement est un outil
 * de mise en place, pas une dépendance), et on le DIT plutôt que d'échouer.
 */
function computeWithPython(
  password: string,
  salt: string,
  iterations: number,
  parallelism: number,
): { key: string } | { unavailable: string } {
  const script = `
import base64, sys, json
try:
    import argon2.low_level as ll
except Exception as exc:
    print(json.dumps({"unavailable": "argon2-cffi absent (%s)" % exc}))
    sys.exit(0)
password, salt, iterations, parallelism, memory, hash_len = (
    sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]),
    int(sys.argv[5]), int(sys.argv[6]),
)
salt_padded = salt + "=" * ((4 - len(salt) % 4) % 4)
raw = ll.hash_secret_raw(
    secret=password.encode("utf-8"),
    salt=base64.b64decode(salt_padded),
    time_cost=iterations,
    memory_cost=memory,
    parallelism=parallelism,
    hash_len=hash_len,
    type=ll.Type.ID,
)
print(json.dumps({"key": base64.b64encode(raw).decode("utf-8").rstrip("=")}))
`;
  try {
    const out = execFileSync(
      'python3',
      [
        '-c',
        script,
        password,
        salt,
        String(iterations),
        String(parallelism),
        String(ARGON2_MEMORY_KIB),
        String(ARGON2_HASH_LENGTH_BYTES),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(out.trim()) as { key: string } | { unavailable: string };
  } catch (err) {
    return {
      unavailable: err instanceof Error ? err.message.split('\n')[0]! : 'python3 indisponible',
    };
  }
}

async function main(): Promise<void> {
  const envPath = val('--env');
  if (envPath) {
    const absolute = resolve(process.cwd(), envPath);
    if (!existsSync(absolute)) fail(`Fichier d'environnement introuvable : ${absolute}`);
    // `loadEnvConfig` lit `.env*` du répertoire ; pour un fichier nommé, on
    // charge à la main pour ne pas dépendre d'une convention de nom.
    const { config } = await import('dotenv').catch(() => ({ config: null }));
    if (config) config({ path: absolute, override: true });
    else loadEnvConfig(process.cwd());
  }

  const crossCheckOnly = has('--cross-check') && !process.env.ADEP_ATS_PASSWORD;

  // En croisement seul, on utilise un couple ARBITRAIRE : le but est de
  // comparer deux implémentations, pas de manipuler le vrai mot de passe.
  const password = crossCheckOnly
    ? 'mot-de-passe-arbitraire-de-croisement'
    : process.env.ADEP_ATS_PASSWORD;
  const salt = crossCheckOnly
    ? Buffer.from('sel-arbitraire-16').toString('base64').replace(/=+$/, '')
    : process.env.ADEP_ARGON2_SALT;
  const iterations = crossCheckOnly ? 3 : Number(process.env.ADEP_ARGON2_ITERATIONS);
  const parallelism = crossCheckOnly ? 1 : Number(process.env.ADEP_ARGON2_PARALLELISM);

  if (!password || !salt) {
    fail(
      'Il faut ADEP_ATS_PASSWORD et ADEP_ARGON2_SALT (plus _ITERATIONS et ' +
        '_PARALLELISM), reçus dans le courriel d’initialisation de l’Apec.\n' +
        '     Pour seulement croiser les deux implémentations sans secret : ' +
        'npm run adep:hash -- --cross-check',
    );
  }

  console.log('\n  ADEP — clé d’authentification Argon2id');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log(`  Variante        Argon2id`);
  console.log(`  Mémoire         ${ARGON2_MEMORY_KIB} Kio`);
  console.log(`  Version         ${ARGON2_VERSION}`);
  console.log(`  Sortie          ${ARGON2_HASH_LENGTH_BYTES} OCTETS (pas bits)`);
  console.log(`  Itérations      ${iterations}`);
  console.log(`  Parallélisme    ${parallelism}`);
  if (crossCheckOnly) {
    console.log('  Jeu d’essai     couple ARBITRAIRE (aucun secret réel utilisé)');
  }
  console.log('');

  const started = Date.now();
  const nodeKey = await computeAtsPassword(password, { salt, iterations, parallelism });
  const elapsed = Date.now() - started;

  console.log(`  Node (@node-rs/argon2, Rust)`);
  console.log(`    longueur      ${nodeKey.length} caractères (attendu ${ARGON2_EXPECTED_KEY_LENGTH})`);
  console.log(`    empreinte     ${fingerprint(nodeKey)}`);
  console.log(`    calcul        ${elapsed} ms`);

  if (nodeKey.length !== ARGON2_EXPECTED_KEY_LENGTH) {
    fail(
      `Longueur inattendue : ${nodeKey.length} au lieu de ${ARGON2_EXPECTED_KEY_LENGTH}. ` +
        'Une sortie de 43 caractères signifierait 32 octets — le piège du commentaire ' +
        'Java « 32 bytes = 256 bits ».',
    );
  }

  if (has('--cross-check')) {
    console.log('');
    const python = computeWithPython(password, salt, iterations, parallelism);
    if ('unavailable' in python) {
      console.log(`  Python (argon2-cffi, C de référence)`);
      console.log(`    ⚠️  indisponible — ${python.unavailable}`);
      console.log(
        '    Le croisement n’a PAS eu lieu. Installez argon2-cffi pour le faire,',
      );
      console.log('    ou considérez la clé comme non recoupée.');
    } else {
      console.log(`  Python (argon2-cffi, C de référence)`);
      console.log(`    longueur      ${python.key.length} caractères`);
      console.log(`    empreinte     ${fingerprint(python.key)}`);
      console.log('');
      if (python.key === nodeKey) {
        console.log('  ✅ CROISEMENT CONCORDANT — les deux implémentations rendent le même octet.');
        console.log('     Notre paramétrage est conforme à ce que la spécification DÉCRIT.');
        console.log('     Cela ne prouve pas ce que l’Apec ATTEND : seul l’appel réel le dira');
        console.log('     (une clé fausse rend API_102_ATS_PASSWORD_INVALID_ERROR).');
      } else {
        fail(
          'CROISEMENT DIVERGENT — les deux implémentations ne rendent pas la même clé.\n' +
            '     Ne posez surtout pas cette valeur : le paramétrage est faux quelque part\n' +
            '     (sel décodé ? mémoire ? version ? longueur de sortie ?).',
        );
      }
    }
  }

  if (has('--reveal') && !crossCheckOnly) {
    console.log('');
    console.log('  ADEP_ATS_PASSWORD_HASH=' + nodeKey);
  } else if (!crossCheckOnly) {
    console.log('');
    console.log('  Ajoutez --reveal pour afficher la clé à recopier dans vos secrets.');
  }
  console.log('');
}

void main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
