/**
 * Calcul de la clé d'authentification ADEP (`atsPassword`).
 *
 * ── CE QUE DIT LA SPEC, ET CE QU'ELLE NE DIT PAS ────────────────────────────
 *
 * Argon2**id**, mémoire 4096 (Kio), version 19 (0x13), longueur de sortie
 * **256 OCTETS**, encodage base64 **sans padding** → une chaîne de 342
 * caractères. Le sel, les itérations et le parallélisme viennent du courriel
 * d'initialisation ; le sel est en **base64 et doit être décodé** avant usage.
 *
 * Les 256 octets sont le point le plus facile à rater. Le code Java de la spec
 * alloue `new byte[256]` sous un commentaire FAUX (`// 32 bytes = 256 bits`) ;
 * le Python, lui, écrit `hash_len=256`. Deux implémentations concordantes
 * contre un commentaire : c'est 256 octets. Un `hash_len=32` produirait une
 * clé parfaitement bien formée et systématiquement refusée.
 *
 * ⚠️ **AUCUN VECTEUR DE TEST OFFICIEL N'EXISTE.** La documentation ne fournit
 * jamais un couple (mot de passe, sel) → clé attendue. Le seul `atsPassword`
 * littéral du document (§IV, 128 caractères hexadécimaux) est un RELIQUAT
 * SHA-512 de la V4, comme les placeholders `PASSWORD_SHA_512` qui traînent
 * dans les exemples de flux : ce ne sont pas des contre-exemples, ce sont des
 * restes. On ne peut donc pas prouver la conformité hors ligne. Ce qu'on fait
 * à la place, et qui est le maximum atteignable :
 *
 *   1. CROISER deux implémentations indépendantes — celle-ci (Rust, via
 *      `@node-rs/argon2`) et `argon2-cffi` (C de référence, via Python). Voir
 *      `npm run adep:hash -- --cross-check`. Elles doivent rendre le même
 *      octet ; si elles divergent, c'est notre paramétrage qui est faux.
 *   2. VALIDER par l'appel réel sur l'environnement de test. Une clé fausse
 *      rend `API_102_ATS_PASSWORD_INVALID_ERROR`, qui est un diagnostic net.
 *
 * ── POURQUOI CE MODULE N'IMPORTE RIEN EN STATIQUE ───────────────────────────
 *
 * La clé est CONSTANTE pour un triplet (mot de passe, sel, paramètres). Elle se
 * calcule une fois et se pose dans `ADEP_ATS_PASSWORD_HASH` : le chemin nominal
 * de production ne hache donc jamais rien, et n'a besoin d'aucune dépendance.
 * `@node-rs/argon2` est une **devDependency**, chargée en `import()` dynamique
 * uniquement quand l'exploitant a choisi de faire calculer la clé au vol. Si
 * elle manque, on le DIT et on donne la commande — plutôt que de faire échouer
 * un déploiement sur un module natif absent.
 */

import { createRequire } from 'node:module';

/** Constantes imposées par l'Apec — jamais configurables. */
export const ARGON2_MEMORY_KIB = 4096;
export const ARGON2_VERSION = 19;
export const ARGON2_HASH_LENGTH_BYTES = 256;
/** base64 sans padding de 256 octets : ceil(256/3)*4 - 2. */
export const ARGON2_EXPECTED_KEY_LENGTH = 342;

export type Argon2Params = {
  /** Sel reçu par courriel, en base64 (padding facultatif). */
  salt: string;
  iterations: number;
  parallelism: number;
};

export class AdepArgon2Error extends Error {
  constructor(
    public readonly code:
      | 'salt_invalid_base64'
      | 'params_invalid'
      | 'module_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'AdepArgon2Error';
  }
}

/**
 * Décode le sel. PUR.
 *
 * Le Python de la spec recomplète le padding manquant — signe que l'Apec
 * envoie un base64 sans `=`. On fait pareil, et on REFUSE plutôt que de
 * deviner si le décodage ne fait pas l'aller-retour : un sel silencieusement
 * tronqué donnerait une clé bien formée et fausse, c'est-à-dire le pire des
 * résultats.
 */
export function decodeArgon2Salt(salt: string): Buffer {
  const trimmed = salt.trim();
  if (trimmed.length === 0) {
    throw new AdepArgon2Error('salt_invalid_base64', 'Le sel Argon2 est vide.');
  }
  const padded = trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64');
  // Node ne lève pas sur du base64 invalide : il ignore les caractères
  // inconnus. L'aller-retour est la seule vérification qui morde.
  if (decoded.toString('base64').replace(/=+$/, '') !== trimmed.replace(/=+$/, '')) {
    throw new AdepArgon2Error(
      'salt_invalid_base64',
      "Le sel Argon2 n'est pas un base64 valide (il est fourni tel quel par l'Apec dans le courriel d'initialisation).",
    );
  }
  return decoded;
}

/** Encode le condensat comme l'attend l'Apec : base64 SANS padding. PUR. */
export function encodeArgon2Key(raw: Uint8Array): string {
  return Buffer.from(raw).toString('base64').replace(/=+$/, '');
}

/**
 * Calcule la clé Argon2id. Charge `@node-rs/argon2` à la demande.
 *
 * Asynchrone parce que l'import l'est — et parce qu'un hachage à 4 Mio de
 * mémoire n'a rien à faire dans une pile synchrone.
 */
export async function computeAtsPassword(
  password: string,
  params: Argon2Params,
): Promise<string> {
  if (!Number.isInteger(params.iterations) || params.iterations < 1) {
    throw new AdepArgon2Error(
      'params_invalid',
      `Nombre d'itérations Argon2 invalide : ${params.iterations}.`,
    );
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < 1) {
    throw new AdepArgon2Error(
      'params_invalid',
      `Degré de parallélisme Argon2 invalide : ${params.parallelism}.`,
    );
  }
  const salt = decodeArgon2Salt(params.salt);

  type Argon2Module = {
    hashRaw: (
      pwd: string,
      opts: {
        algorithm: number;
        version: number;
        memoryCost: number;
        timeCost: number;
        parallelism: number;
        outputLen: number;
        salt: Buffer;
      },
    ) => Promise<Uint8Array>;
    Algorithm: { Argon2id: number };
    Version: { V0x13: number };
  };

  let argon2: Argon2Module;
  try {
    // ⚠️ `createRequire` avec un spécifieur VARIABLE, et non `await
    // import('@node-rs/argon2')`. Le module est une devDependency : un import
    // littéral serait résolu par le bundler de Next au moment du BUILD, et le
    // paquet, absent de la production, ferait échouer la compilation de la
    // première route qui touche à ce fichier — au lieu de dégrader vers le
    // message ci-dessous. Le spécifieur indirect est opaque au bundler, donc
    // la dépendance reste réellement optionnelle. Ce module est server-only
    // (runtime nodejs), `createRequire` y est légitime.
    const specifier = ['@node-rs', 'argon2'].join('/');
    const require = createRequire(import.meta.url);
    argon2 = require(specifier) as Argon2Module;
  } catch {
    throw new AdepArgon2Error(
      'module_unavailable',
      "Le module @node-rs/argon2 n'est pas installé. La clé se précalcule une " +
        'fois avec `npm run adep:hash` et se pose dans ADEP_ATS_PASSWORD_HASH ; ' +
        "l'application n'a alors rien à hacher.",
    );
  }

  const raw = await argon2.hashRaw(password, {
    algorithm: argon2.Algorithm.Argon2id,
    version: argon2.Version.V0x13,
    memoryCost: ARGON2_MEMORY_KIB,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    outputLen: ARGON2_HASH_LENGTH_BYTES,
    salt,
  });
  return encodeArgon2Key(raw);
}

/**
 * Résout la clé depuis l'environnement. Le hash précalculé PRIME : c'est le
 * chemin nominal, et il n'exige aucune dépendance.
 */
export async function resolveAtsPasswordFromEnv(
  // `Partial<Record<…>>` plutôt que `NodeJS.ProcessEnv` : le type de Node exige
  // `NODE_ENV`, ce qui obligerait chaque appelant de test à fabriquer un faux
  // environnement complet — et donc à écrire un `as` qui masquerait de vraies
  // erreurs de nom de variable.
  env: Partial<Record<string, string>> = process.env,
): Promise<string> {
  const precomputed = env.ADEP_ATS_PASSWORD_HASH?.trim();
  if (precomputed) return precomputed;

  const password = env.ADEP_ATS_PASSWORD;
  const salt = env.ADEP_ARGON2_SALT;
  const iterations = Number(env.ADEP_ARGON2_ITERATIONS);
  const parallelism = Number(env.ADEP_ARGON2_PARALLELISM);
  if (!password || !salt) {
    throw new AdepArgon2Error(
      'params_invalid',
      'Aucune clé ADEP : posez ADEP_ATS_PASSWORD_HASH, ou ADEP_ATS_PASSWORD ' +
        'avec ADEP_ARGON2_SALT / _ITERATIONS / _PARALLELISM.',
    );
  }
  return computeAtsPassword(password, { salt, iterations, parallelism });
}
