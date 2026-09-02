/**
 * Pseudonymisation d'une charge utile (journal, métadonnées d'artefact) — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §5.2.
 *
 * L'événement reste, l'identité part. Deux ceintures, et c'est délibéré :
 *
 *   1. PAR CLÉ — les clés dont on SAIT qu'elles portent le candidat sont
 *      remplacées en entier, quelle que soit la valeur. Elles peuvent contenir
 *      une variante d'adresse que la seconde ceinture ne reconnaîtrait pas.
 *      Le registre est UNIQUE et partagé avec le contrôle
 *      (`identity-keys.ts`) : ce que le contrôle sait détecter, le caviardage
 *      sait le traiter, et un test tient les deux sens.
 *   2. PAR VALEUR — toute chaîne CONTENANT une des empreintes du candidat
 *      (adresse, jeton de nom, forme « slug », téléphone) est caviardée, quelle
 *      que soit sa clé. C'est ce qui protège des clés qu'on n'a pas anticipées :
 *      une action ajoutée demain avec un champ nominatif inédit est couverte
 *      sans qu'on ait pensé à elle.
 *
 * ⚠️ Ce que l'on NE touche PAS : `actorEmail`, `by`, `decidedByUserId`,
 * `decidedByUserEmail` désignent le RECRUTEUR — l'agent du responsable de
 * traitement qui a pris la décision. Les effacer supprimerait l'auteur de
 * l'acte, c'est-à-dire la preuve qu'un humain identifié l'a pris. Aucune
 * exemption n'est nécessaire pour eux : la seconde ceinture ne compare qu'aux
 * empreintes du CANDIDAT, une adresse de recruteur n'y répond pas.
 */

import { isIdentityKey } from '@/lib/gdpr/identity-keys';
import { containsErasureMarker } from '@/lib/gdpr/marker';

/** Empreintes du candidat, précalculées une fois par purge. */
export type SubjectFingerprint = {
  /** Adresses normalisées (minuscules), la principale et ses variantes. */
  emails: string[];
  /**
   * Adresse DÉCOUPÉE en fragments alphanumériques (`['yvanbisseg','yahoo','fr']`).
   * Sert à reconnaître une adresse dont les séparateurs ont été remplacés —
   * la forme des noms de fichiers construits sur l'adresse du candidat
   * (`yvanbisseg_yahoo.fr_PROFIL.pdf`). C'est un identifiant FORT : il ne
   * dérive que de l'adresse, il ne désigne donc qu'une personne.
   */
  emailChunks: string[][];
  /** Jetons de nom normalisés (≥ 3 caractères, sans accent). */
  nameTokens: string[];
  /** Formes « slug » des noms complets (`jean-dupont`), telles qu'en fichier. */
  slugs: string[];
  /** Derniers chiffres significatifs des téléphones (9 chiffres). */
  phoneTails: string[];
};

const MAX_DEPTH = 8;

// ─── Normalisation ─────────────────────────────────────────────────────────

/** Minuscules + suppression des diacritiques. La longueur CHANGE : ne jamais
 *  s'en servir pour calculer un décalage dans la chaîne d'origine. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

function digits(s: string): string {
  return s.replace(/\D/gu, '');
}

/** Forme « slug » telle que produite par les noms d'artefacts (`slug()`). */
function slugify(s: string): string {
  return norm(s)
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * Construit les empreintes. Les jetons de moins de 3 caractères sont écartés :
 * « de », « le », « al » caviarderaient des mots ordinaires. Le caviardage
 * n'opère de toute façon QUE sur des lignes déjà rattachées au candidat.
 */
export function buildFingerprint(input: {
  emails: (string | null | undefined)[];
  names: (string | null | undefined)[];
  phones: (string | null | undefined)[];
}): SubjectFingerprint {
  const emails = uniq(
    input.emails.filter(isNonEmpty).map((e) => norm(e.trim())),
  );
  // Fragments alphanumériques de chaque adresse. On exige un fragment de tête
  // (la partie locale) d'au moins 3 caractères : `a@b.fr` produirait sinon un
  // motif qui mordrait sur n'importe quoi.
  const emailChunks = emails
    .map((e) => e.split(/[^a-z0-9]+/u).filter((c) => c.length > 0))
    .filter((chunks) => chunks.length >= 2 && (chunks[0]?.length ?? 0) >= 3);
  const names = input.names.filter(isNonEmpty).map((n) => n.trim());
  const nameTokens = uniq(
    names.flatMap((n) => norm(n).split(/[^a-z0-9]+/u)).filter((t) => t.length >= 3),
  );
  const slugs = uniq(names.map(slugify).filter((s) => s.length >= 3));
  const phoneTails = uniq(
    input.phones
      .filter(isNonEmpty)
      .map((p) => digits(p))
      .filter((d) => d.length >= 9)
      .map((d) => d.slice(-9)),
  );
  return { emails, emailChunks, nameTokens, slugs, phoneTails };
}

function isNonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)].filter((x) => x.length > 0);
}

// ─── Détection ─────────────────────────────────────────────────────────────

/** La chaîne porte-t-elle une empreinte du candidat ? */
export function isContaminated(value: string, fp: SubjectFingerprint): boolean {
  const n = norm(value);
  if (fp.emails.some((e) => n.includes(e))) return true;
  // Adresse dont les séparateurs ont été remplacés : la forme d'un nom de
  // fichier construit sur l'adresse (`yvanbisseg_yahoo.fr_PROFIL.pdf`, ou
  // même `yvanbisseggmailcom`). Les fragments doivent rester DANS L'ORDRE et
  // adjacents à des séparateurs près — deux fragments retrouvés au hasard
  // dans un long texte ne suffisent pas.
  if (fp.emailChunks.some((chunks) => mangledEmailRe(chunks).test(n))) return true;
  if (fp.slugs.some((s) => n.includes(s))) return true;
  if (fp.nameTokens.some((t) => hasWord(n, t))) return true;
  if (fp.phoneTails.length > 0) {
    const d = digits(value);
    if (d.length >= 9 && fp.phoneTails.some((t) => d.includes(t))) return true;
  }
  return false;
}

/**
 * Empreinte réduite aux identifiants qui DÉSIGNENT UNE SEULE PERSONNE.
 *
 * Seule l'adresse électronique en est un. Ni le nom (des milliers d'homonymes),
 * ni — et c'est moins intuitif — le TÉLÉPHONE : un fixe de foyer, un standard
 * d'entreprise, un numéro professionnel partagé appartiennent légitimement à
 * plusieurs personnes. Les fixtures de la suite de régression le montrent en
 * miniature : trois candidats distincts y portent le même numéro.
 *
 * Conséquence tenue partout : un téléphone CAVIARDE à l'intérieur d'une ligne
 * déjà retenue, mais il n'y FAIT jamais entrer une ligne, et une occurrence
 * hors périmètre est un AVERTISSEMENT à trancher par un humain, jamais un
 * échec — ni un motif de suppression.
 *
 * Un seul point de vérité : `journal-scope`, `storage-plan` et `verify`
 * appellent tous cette fonction. Trois copies de `{ ...fp, nameTokens: [] }`
 * auraient divergé, et la divergence aurait été SILENCIEUSE.
 */
export function strongIdentifiersOnly(fp: SubjectFingerprint): SubjectFingerprint {
  return {
    emails: fp.emails,
    emailChunks: fp.emailChunks,
    nameTokens: [],
    slugs: [],
    phoneTails: [],
  };
}

/**
 * Motif d'adresse « démantelée » : les fragments dans l'ordre, séparés par
 * n'importe quoi qui ne soit pas alphanumérique — y compris RIEN. Bordé pour
 * ne pas mordre au milieu d'un mot plus long.
 */
function mangledEmailRe(chunks: string[]): RegExp {
  const body = chunks.map(escapeRe).join('[^a-z0-9]*');
  return new RegExp(`(^|[^a-z0-9])${body}([^a-z0-9]|$)`, 'u');
}

/** Occurrence en MOT entier — « art » ne doit pas mordre sur « artefact ». */
function hasWord(haystackNorm: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystackNorm.indexOf(token, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : haystackNorm[i - 1]!;
    const after = haystackNorm[i + token.length] ?? '';
    if (!/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after)) return true;
    from = i + 1;
  }
}

// ─── Caviardage ────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Retire les empreintes d'une chaîne en gardant ce qui l'entoure — un objet de
 * message reste lisible (« Candidature — Dev Java (CAMP-2026-051) »).
 *
 * Le caviardage s'opère sur la chaîne D'ORIGINE, insensible à la casse. Si,
 * après passage, la chaîne reste contaminée (accents, forme non couverte,
 * téléphone enchâssé), on remplace la chaîne ENTIÈRE par le marqueur :
 * mieux vaut perdre du contexte qu'un résidu nominatif.
 */
export function redactString(
  value: string,
  fp: SubjectFingerprint,
  marker: string,
): string {
  if (!isContaminated(value, fp)) return value;

  let out = value;
  for (const chunks of fp.emailChunks) {
    // Le motif est construit sur la forme NORMALISÉE ; il s'applique ici à la
    // chaîne d'origine, insensible à la casse. Un accent au milieu d'une
    // adresse échapperait au motif — le filet de sécurité en fin de fonction
    // remplace alors la chaîne entière.
    const body = chunks.map(escapeRe).join('[^a-zA-Z0-9]*');
    out = out.replace(new RegExp(body, 'giu'), marker);
  }
  for (const needle of [...fp.emails, ...fp.slugs, ...fp.nameTokens]) {
    out = out.replace(new RegExp(escapeRe(needle), 'giu'), marker);
  }
  // Un caviardage qui laisse passer quelque chose n'a pas fait son travail.
  if (isContaminated(out, fp)) return marker;
  // Chaîne devenue une suite de marqueurs et de ponctuation : on la simplifie.
  return out;
}

// ─── Parcours ──────────────────────────────────────────────────────────────

export type PseudonymizeResult<T> = { value: T; changed: boolean };

/**
 * Pseudonymise une charge utile structurée. Renvoie `changed: false` si rien
 * n'a bougé — c'est ce qui rend le rejeu idempotent et permet de ne réécrire
 * en base que les lignes réellement touchées.
 */
export function pseudonymizePayload(
  payload: Record<string, unknown>,
  fp: SubjectFingerprint,
  marker: string,
): PseudonymizeResult<Record<string, unknown>> {
  let changed = false;
  const walk = (value: unknown, key: string | null, depth: number): unknown => {
    if (depth > MAX_DEPTH) return value;

    if (typeof value === 'string') {
      // Déjà purgé par une demande antérieure : on n'empile pas les marqueurs.
      if (containsErasureMarker(value)) return value;
      if (key !== null && isIdentityKey(key) && value.trim().length > 0) {
        changed = true;
        return marker;
      }
      const redacted = redactString(value, fp, marker);
      if (redacted !== value) changed = true;
      return redacted;
    }

    if (Array.isArray(value)) {
      // Une clé nominative portant une LISTE (`fileNames`, `storedFiles`,
      // `unsupportedFiles`) : la clé du PARENT est conservée pendant la
      // descente, donc chaque chaîne de la liste est remplacée par un
      // marqueur — jamais vidée (la longueur est un fait : « 3 pièces
      // jointes » reste vrai). Pour une liste d'OBJETS (`attachments`), la
      // descente reprend ensuite la clé propre de chaque champ (`filename`),
      // qui est elle aussi au registre.
      return value.map((v) => walk(v, key, depth + 1));
    }

    if (value !== null && typeof value === 'object') {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = walk(v, k, depth + 1);
      return out;
    }

    return value;
  };

  const value = walk(payload, null, 0) as Record<string, unknown>;
  return { value, changed };
}

/**
 * La charge utile porte-t-elle encore une empreinte du candidat ? Sert au
 * contrôle final : on repasse sur ce qu'on a écrit, on ne se croit pas sur
 * parole.
 */
export function payloadStillContaminated(
  payload: unknown,
  fp: SubjectFingerprint,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof payload === 'string') {
    return !containsErasureMarker(payload) && isContaminated(payload, fp);
  }
  if (Array.isArray(payload)) {
    return payload.some((v) => payloadStillContaminated(v, fp, depth + 1));
  }
  if (payload !== null && typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>).some((v) =>
      payloadStillContaminated(v, fp, depth + 1),
    );
  }
  return false;
}
