/**
 * Audit d'une charge utile : QUELS champs portent encore une identité — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.4.
 *
 * ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────
 * Le contrôle sérialisait la LIGNE ENTIÈRE en JSON et cherchait les
 * empreintes dans cette grande chaîne. Trois défauts en découlaient, et les
 * trois se sont manifestés :
 *
 *   1. Il ne disait pas OÙ. « journal#594 » sans le champ oblige à rouvrir la
 *      ligne à la main. Une alerte qu'on ne peut pas trier ne se trie pas.
 *   2. Il se déclenchait sur SA PROPRE TRACE. Le marqueur porte la référence
 *      de la demande ; quand celle-ci contient le nom de la personne
 *      (« demande de Jean Dupont du 27/08 » — la forme naturelle), chaque
 *      ligne correctement caviardée redevenait une alerte.
 *   3. Le téléphone était cherché dans les chiffres de TOUTE la ligne
 *      concaténés — identifiants, horodatages, scores mis bout à bout. Une
 *      collision entre deux champs sans rapport produit un numéro qui
 *      n'existe nulle part.
 *
 * D'où un parcours CHAMP PAR CHAMP qui rend un chemin (`fileNames[0]`), une
 * RAISON, et sépare ce qui est prouvé de ce qui est à trancher.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  isIdentityKey,
  isRecruiterKey,
  isTechnicalKey,
} from '@/lib/gdpr/identity-keys';
import {
  isContaminated,
  strongIdentifiersOnly,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';

/**
 * · `identity_key` — un champ du registre porte encore une valeur en clair.
 *   C'est un défaut STRUCTUREL : il ne dépend pas de la reconnaissance de la
 *   valeur. C'est ce verdict qui aurait attrapé `fileNames` le premier jour,
 *   sans que personne ait à reconnaître une adresse déguisée en nom de
 *   fichier.
 * · `strong` — la valeur contient l'ADRESSE (ou sa forme démantelée). Elle ne
 *   désigne qu'une personne : c'est un résidu, sans discussion.
 * · `weak` — la valeur contient un NOM ou un TÉLÉPHONE, et rien d'autre. Hors
 *   périmètre, c'est un homonyme PROBABLE, à trancher par un humain ; dans le
 *   périmètre, c'est un résidu.
 */
export type AuditReason = 'identity_key' | 'strong' | 'weak';

export type AuditFinding = {
  /** Chemin dans la charge utile : `fileNames[0]`, `attachments[1].filename`. */
  path: string;
  reason: AuditReason;
  /** Ce qui a déclenché : nom du champ, jeton de nom, « adresse ». */
  trigger: string;
  /** Fragment court autour de l'occurrence. JAMAIS transmis au client. */
  sample: string;
};

const MAX_DEPTH = 8;

/**
 * Une chaîne peut CONTENIR un marqueur sans être propre pour autant (un corps
 * de rapport partiellement réécrit). On retire les marqueurs avant de juger,
 * plutôt que de sauter la chaîne entière : c'est le compromis entre « ne pas
 * crier sur sa propre trace » et « ne pas se cacher derrière elle ».
 */
const MARKER_RE = /\[effacé(?: — demande RGPD [^\]]*|-rgpd-\d+)\]/gu;

export function stripMarkers(value: string): string {
  return value.replace(MARKER_RE, ' ');
}

/**
 * Rend les CONSTATS, pas les verdicts. C'est l'appelant qui tranche selon le
 * périmètre : dans le périmètre, un `weak` est un résidu (on sait déjà que la
 * ligne concerne cette personne) ; hors périmètre, c'est un homonyme probable
 * à soumettre à un humain. Mettre cette règle ici obligerait chaque appelant
 * à connaître le périmètre pour poser une question qui n'en dépend pas.
 */
export function auditPayload(
  payload: unknown,
  fp: SubjectFingerprint,
): AuditFinding[] {
  const strong = strongIdentifiersOnly(fp);
  const findings: AuditFinding[] = [];

  const walk = (value: unknown, path: string, key: string | null, depth: number): void => {
    if (depth > MAX_DEPTH) return;

    if (typeof value === 'string') {
      inspect(value, path, key, findings, fp, strong);
      return;
    }
    if (Array.isArray(value)) {
      // La clé du PARENT descend avec la liste : `fileNames[0]` reste un nom
      // de fichier, et doit être jugé comme tel.
      value.forEach((v, i) => walk(v, `${path}[${i}]`, key, depth + 1));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, k, depth + 1);
      }
    }
  };

  walk(payload, '', null, 0);
  return findings;
}

function inspect(
  raw: string,
  path: string,
  key: string | null,
  out: AuditFinding[],
  fp: SubjectFingerprint,
  strong: SubjectFingerprint,
): void {
  // Le nettoyage retire NOS marqueurs : le contrôle ne se plaint jamais de sa
  // propre trace, même quand la référence de la demande porte le nom.
  const value = stripMarkers(raw).trim();

  // 1. STRUCTUREL — un champ du registre qui porte encore quelque chose.
  //    Aucune reconnaissance de valeur n'est requise : c'est ce qui rend le
  //    contrôle indépendant de la finesse des empreintes.
  if (key !== null && isIdentityKey(key) && value.length > 0) {
    out.push({
      path,
      reason: 'identity_key',
      trigger: `champ « ${key} » non caviardé`,
      sample: clip(raw),
    });
    return;
  }

  if (value.length === 0) return;
  if (key !== null && isRecruiterKey(key)) return; // le recruteur reste, par décision

  // 2. FORT — l'adresse, en clair ou démantelée. Ne désigne qu'une personne.
  if (isContaminated(value, strong)) {
    out.push({ path, reason: 'strong', trigger: 'adresse', sample: clip(raw) });
    return;
  }

  // 3. FAIBLE — nom ou téléphone seul. Sur un identifiant technique, c'est du
  //    bruit : un uuid ou un jeton qui contient par accident une suite de
  //    lettres n'est pas une personne, et le signaler à chaque exécution
  //    apprend à l'opérateur à ne plus lire ces lignes.
  if (key !== null && isTechnicalKey(key)) return;
  const token = weakTrigger(value, fp);
  if (token) out.push({ path, reason: 'weak', trigger: token, sample: clip(raw) });
}

/**
 * Ce qui a déclenché la branche faible — NOMMÉ. « journal#123 » n'apprend
 * rien ; « journal#123 · payload.reason · jeton de nom "dupont" » se tranche
 * en une seconde.
 */
function weakTrigger(value: string, fp: SubjectFingerprint): string | null {
  const nameOnly: SubjectFingerprint = {
    emails: [],
    emailChunks: [],
    nameTokens: fp.nameTokens,
    slugs: fp.slugs,
    phoneTails: [],
  };
  if (isContaminated(value, nameOnly)) {
    const hit =
      fp.slugs.find((s) => value.toLowerCase().includes(s)) ??
      fp.nameTokens.find((t) => isContaminated(value, { ...nameOnly, slugs: [], nameTokens: [t] }));
    return `jeton de nom « ${hit ?? '?'} »`;
  }
  const phoneOnly: SubjectFingerprint = {
    emails: [],
    emailChunks: [],
    nameTokens: [],
    slugs: [],
    phoneTails: fp.phoneTails,
  };
  // Le téléphone n'est cherché que dans une chaîne À MAJORITÉ de chiffres.
  // Cherché dans un texte quelconque, il produit des collisions entre nombres
  // sans rapport — et un numéro partagé n'est de toute façon jamais une preuve.
  if (looksNumeric(value) && isContaminated(value, phoneOnly)) {
    return 'téléphone (potentiellement partagé)';
  }
  return null;
}

function looksNumeric(value: string): boolean {
  const d = value.replace(/\D/gu, '').length;
  return d >= 9 && d >= value.length / 2;
}

function clip(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}…`;
}

/**
 * Le champ reste-t-il porteur d'identité APRÈS caviardage ? Utilisé par le
 * test d'anti-divergence : tout ce que `auditPayload` sait détecter doit
 * disparaître au passage de `pseudonymizePayload`.
 */
export function hasResidue(findings: AuditFinding[]): boolean {
  return findings.some((f) => f.reason !== 'weak');
}
