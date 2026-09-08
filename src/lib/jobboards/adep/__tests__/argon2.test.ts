/**
 * Argon2id — paramétrage et pièges.
 *
 * ⚠️ Ces tests ne prouvent PAS la conformité à ce que l'Apec attend : aucun
 * vecteur de test officiel n'existe (cf. l'en-tête de `argon2.ts`). Ils
 * prouvent trois choses, qui sont ce qu'on peut prouver hors ligne :
 *
 *   1. le paramétrage est celui que la spécification DÉCRIT (256 octets,
 *      base64 sans padding, sel décodé) ;
 *   2. la valeur est STABLE — une régression de paramètre serait vue ;
 *   3. le piège de la longueur MORD : 32 octets ne rend pas un préfixe des
 *      256 octets mais une clé entièrement différente. On ne peut donc pas
 *      « rattraper » une mauvaise longueur, et se tromper est irrécupérable
 *      sans recalcul.
 *
 * La valeur épinglée ci-dessous a été produite par les DEUX implémentations
 * indépendantes (Rust via @node-rs/argon2, C de référence via argon2-cffi),
 * qui rendent le même octet — c'est le croisement de `npm run adep:hash --
 * --cross-check`.
 */
import { describe, expect, it } from 'vitest';

import {
  ARGON2_EXPECTED_KEY_LENGTH,
  ARGON2_HASH_LENGTH_BYTES,
  ARGON2_MEMORY_KIB,
  ARGON2_VERSION,
  AdepArgon2Error,
  computeAtsPassword,
  decodeArgon2Salt,
  encodeArgon2Key,
  resolveAtsPasswordFromEnv,
} from '../argon2';

/** Le couple ARBITRAIRE du croisement — aucun secret réel. */
const PASSWORD = 'mot-de-passe-arbitraire-de-croisement';
const SALT = Buffer.from('sel-arbitraire-16').toString('base64').replace(/=+$/, '');
const PARAMS = { salt: SALT, iterations: 3, parallelism: 1 };

/**
 * Concordant entre @node-rs/argon2 (Rust) et argon2-cffi (C de référence),
 * mesuré le 08/09/2026. Épingler la clé ENTIÈRE plutôt qu'une empreinte : une
 * empreinte cacherait une divergence de padding, qui est exactement l'un des
 * points où la spec est ambiguë.
 */
const EXPECTED_KEY =
  'gKNwc3+5LsrOTmIe059cduQsNQSqj9lrjDrBd7x/3G935OXFp3bDJ8GErlTL' +
  'j9qiVjeC9q2X0KOfGKsbBMFTagQVfMN5SWUC8RnezBol6ulVLoJirgRmgdZP' +
  'X4W/zDy96rMzNmSPFx3HV1YqCjxThl1DNQ2SwyG5Y8dCD7GBafWEfO1uPmS8' +
  'Phqhb361S5VwXG1D4YHmWPOYqQE4B4O7kTu5BNpihjU+vowTVdV/Kt2e9IrI' +
  'YEFrFcT25Qoz4zHGVULPE3kNJ0RMhL4zTCC4kXKX9U7QQ1NbofjNN7c08LWD' +
  'OqqG4yQU7cfqHiGroOzcH+fqOwHX0yp0iD9mXuU/ow';

describe('constantes imposées par l’Apec', () => {
  it('256 OCTETS, pas 256 bits', () => {
    // Le code Java de la spec alloue `new byte[256]` sous un commentaire faux
    // (« 32 bytes = 256 bits ») ; le Python écrit `hash_len=256`. Deux
    // implémentations contre un commentaire.
    expect(ARGON2_HASH_LENGTH_BYTES).toBe(256);
    expect(ARGON2_MEMORY_KIB).toBe(4096);
    expect(ARGON2_VERSION).toBe(19);
    // base64 sans padding de 256 octets.
    expect(ARGON2_EXPECTED_KEY_LENGTH).toBe(342);
  });
});

describe('sel', () => {
  it('est décodé depuis le base64, padding facultatif', () => {
    const withPadding = Buffer.from('abcde').toString('base64'); // 'YWJjZGU='
    const without = withPadding.replace(/=+$/, '');
    expect(decodeArgon2Salt(withPadding).toString()).toBe('abcde');
    expect(decodeArgon2Salt(without).toString()).toBe('abcde');
  });

  it('refuse un sel qui n’est pas du base64 plutôt que de le tronquer', () => {
    // Node n'échoue pas sur du base64 invalide : il ignore les caractères
    // inconnus. Sans l'aller-retour, un sel silencieusement amputé donnerait
    // une clé bien formée et fausse — le pire résultat possible.
    expect(() => decodeArgon2Salt('sel en clair !!')).toThrow(AdepArgon2Error);
    expect(() => decodeArgon2Salt('  ')).toThrow(AdepArgon2Error);
  });

  it('encode sans padding', () => {
    expect(encodeArgon2Key(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA');
    expect(encodeArgon2Key(new Uint8Array([1]))).not.toContain('=');
  });
});

describe('calcul de la clé', () => {
  it('rend 342 caractères, et la valeur croisée avec argon2-cffi', async () => {
    const key = await computeAtsPassword(PASSWORD, PARAMS);
    expect(key).toHaveLength(ARGON2_EXPECTED_KEY_LENGTH);
    expect(key).not.toContain('=');
    expect(key).toBe(EXPECTED_KEY);
  });

  it('est déterministe', async () => {
    const a = await computeAtsPassword(PASSWORD, PARAMS);
    const b = await computeAtsPassword(PASSWORD, PARAMS);
    expect(a).toBe(b);
  });

  it('change avec chaque paramètre — aucun n’est décoratif', async () => {
    const base = await computeAtsPassword(PASSWORD, PARAMS);
    const otherIterations = await computeAtsPassword(PASSWORD, {
      ...PARAMS,
      iterations: 4,
    });
    const otherParallelism = await computeAtsPassword(PASSWORD, {
      ...PARAMS,
      parallelism: 2,
    });
    const otherSalt = await computeAtsPassword(PASSWORD, {
      ...PARAMS,
      salt: Buffer.from('un-autre-sel-1234').toString('base64'),
    });
    expect(new Set([base, otherIterations, otherParallelism, otherSalt]).size).toBe(4);
  });

  it('refuse des paramètres absurdes plutôt que de hacher n’importe quoi', async () => {
    await expect(
      computeAtsPassword(PASSWORD, { ...PARAMS, iterations: 0 }),
    ).rejects.toThrow(AdepArgon2Error);
    await expect(
      computeAtsPassword(PASSWORD, { ...PARAMS, parallelism: Number.NaN }),
    ).rejects.toThrow(AdepArgon2Error);
  });
});

describe('résolution depuis l’environnement', () => {
  it('préfère le hash précalculé — le chemin de production ne hache rien', async () => {
    const key = await resolveAtsPasswordFromEnv({
      ADEP_ATS_PASSWORD_HASH: 'precalculee',
      ADEP_ATS_PASSWORD: PASSWORD,
      ADEP_ARGON2_SALT: SALT,
      ADEP_ARGON2_ITERATIONS: '3',
      ADEP_ARGON2_PARALLELISM: '1',
    });
    expect(key).toBe('precalculee');
  });

  it('calcule au vol quand seuls le mot de passe et les paramètres sont posés', async () => {
    const key = await resolveAtsPasswordFromEnv({
      ADEP_ATS_PASSWORD: PASSWORD,
      ADEP_ARGON2_SALT: SALT,
      ADEP_ARGON2_ITERATIONS: '3',
      ADEP_ARGON2_PARALLELISM: '1',
    });
    expect(key).toHaveLength(ARGON2_EXPECTED_KEY_LENGTH);
  });

  it('dit clairement ce qui manque plutôt que de rendre une clé vide', async () => {
    await expect(resolveAtsPasswordFromEnv({})).rejects.toThrow(
      /ADEP_ATS_PASSWORD_HASH/,
    );
  });

  it('ignore un hash vide — une variable posée à blanc ne masque pas le calcul', async () => {
    const key = await resolveAtsPasswordFromEnv({
      ADEP_ATS_PASSWORD_HASH: '   ',
      ADEP_ATS_PASSWORD: PASSWORD,
      ADEP_ARGON2_SALT: SALT,
      ADEP_ARGON2_ITERATIONS: '3',
      ADEP_ARGON2_PARALLELISM: '1',
    });
    expect(key).toHaveLength(ARGON2_EXPECTED_KEY_LENGTH);
  });
});

describe('le piège de la longueur', () => {
  it('32 octets ne sont PAS un préfixe des 256 — l’erreur est irrécupérable', async () => {
    const argon2 = (await import('@node-rs/argon2')) as unknown as {
      hashRaw: (pwd: string, opts: Record<string, unknown>) => Promise<Uint8Array>;
      Algorithm: { Argon2id: number };
      Version: { V0x13: number };
    };
    const short = await argon2.hashRaw(PASSWORD, {
      algorithm: argon2.Algorithm.Argon2id,
      version: argon2.Version.V0x13,
      memoryCost: ARGON2_MEMORY_KIB,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
      salt: decodeArgon2Salt(SALT),
    });
    const full = await computeAtsPassword(PASSWORD, PARAMS);
    const truncated = encodeArgon2Key(short);
    expect(truncated).toHaveLength(43);
    // Le point : on ne peut pas rattraper une mauvaise longueur en tronquant.
    // Argon2 dérive une sortie de longueur N d'un seul bloc — changer N change
    // TOUT. D'où le contrôle de longueur, dur, dans `adep:hash`.
    expect(full.startsWith(truncated)).toBe(false);
  });
});
