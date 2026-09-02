/**
 * Le PÉRIMÈTRE d'une demande : quelles lignes le contrôle a le droit de lire — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.4.
 *
 * ─── L'INCIDENT QUI A CRÉÉ CE MODULE (02/09/2026, production) ─────────────
 * Le rejeu d'une purge sur un périmètre DÉJÀ EFFACÉ — donc vide — a rendu
 * « résidus nominatifs : 6525 » en nommant tous les AUTRES candidats de la
 * base. Le contrôle balayait les tables ENTIÈRES sans le moindre filtre, puis
 * auditait chaque ligne. Or le verdict `identity_key` est STRUCTUREL : il se
 * déclenche sur toute valeur non vide d'un champ du registre, sans regarder
 * l'empreinte. Toute ligne portant un `candidate_name` devenait donc un
 * « résidu » — c'est-à-dire toute la base.
 *
 * ⚠️ Ce n'était pas propre au périmètre vide. La MÊME exécution sur un
 * périmètre plein rendait les mêmes 6525 lignes : le contrôle n'a jamais
 * filtré. Le périmètre vide n'a fait que retirer les quelques lignes
 * légitimes du tas, rendant le défaut enfin visible.
 *
 * ─── LA RÈGLE ────────────────────────────────────────────────────────────
 * Un résidu ne peut être qu'une occurrence d'un identifiant de CETTE
 * personne. Une ligne qui n'appartient pas au périmètre n'est donc pas un
 * résidu possible : elle n'est PAS AUDITÉE, et rien d'elle n'est retenu.
 *
 * Deux portes d'entrée, et deux seulement — les mêmes que pour le journal
 * (`journal-scope.ts`, §7.3) :
 *   1. un IDENTIFIANT du périmètre (identifiant d'analyse, uid, dossier de
 *      vivier, briefing, réservation…) ;
 *   2. l'ADRESSE présente dans la ligne, en clair ou démantelée.
 *
 * **Le nom ne fait jamais entrer une ligne**, ni le téléphone : c'est par eux
 * que la base entière est remontée. Ils restent utiles À L'INTÉRIEUR d'une
 * ligne déjà retenue.
 *
 * ⚠️ La porte 2 se vérifie EN JAVASCRIPT, jamais par la requête. Une requête
 * `ilike` sert à ne pas tout rapatrier ; c'est un FILTRE DE FETCH, pas un
 * verdict. Confondre les deux, c'est laisser une correspondance approximative
 * de SQL décider qu'une ligne appartient à quelqu'un.
 */

import {
  isContaminated,
  type SubjectFingerprint,
} from '@/lib/gdpr/payload-pseudonymize';
import type { ErasureIdentity } from '@/types/gdpr';

const MAX_DEPTH = 8;

/**
 * Les champs d'identité qui constituent le PÉRIMÈTRE. `emails`, `names` et
 * `phones` en sont ABSENTS de propos délibéré : ce sont des termes de
 * recherche, pas des lignes retrouvées. Une commande lancée avec une adresse
 * qui ne correspond à rien a bien un terme, et un périmètre vide.
 */
const PERIMETER_FIELDS = [
  'analysisIds',
  'uids',
  'campaignIds',
  'fileNames',
  'vivierIds',
  'briefIds',
  'validationIds',
  'linkTokens',
  'bookingIds',
  'artifactIds',
  'unmatchedIds',
  'storagePaths',
] as const satisfies readonly (keyof ErasureIdentity)[];

/**
 * Rien n'a été retrouvé pour cette personne dans cet environnement.
 *
 * C'est le résultat NORMAL d'un rejeu : l'effacement a porté, il ne reste
 * plus rien à quoi se rattacher. Le contrôle n'a alors pas d'objet — et il ne
 * doit surtout pas s'exécuter « au cas où » : sans identifiant, il n'a plus
 * rien pour distinguer cette personne des autres, et c'est exactement le
 * chemin par lequel il a listé la base entière.
 */
export function perimeterIsEmpty(identity: ErasureIdentity): boolean {
  const empty = PERIMETER_FIELDS.every((f) => (identity[f] as string[]).length === 0);
  return empty && identity.imapRefs.length === 0;
}

/** Combien d'éléments le périmètre porte — pour le dire à l'opérateur. */
export function perimeterSize(identity: ErasureIdentity): number {
  return (
    PERIMETER_FIELDS.reduce((n, f) => n + (identity[f] as string[]).length, 0) +
    identity.imapRefs.length
  );
}

/**
 * La ligne porte-t-elle un identifiant FORT du sujet (l'adresse, en clair ou
 * démantelée) ? Parcours en profondeur : l'adresse peut être enfouie dans une
 * charge utile, et c'est même le cas le plus courant.
 *
 * ⚠️ L'empreinte passée ici DOIT être réduite (`strongIdentifiersOnly`).
 * Passer l'empreinte complète ferait entrer les homonymes — le défaut que ce
 * module existe pour empêcher.
 */
export function carriesStrongIdentifier(
  value: unknown,
  strong: SubjectFingerprint,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === 'string') return isContaminated(value, strong);
  if (Array.isArray(value)) {
    return value.some((v) => carriesStrongIdentifier(v, strong, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) =>
      carriesStrongIdentifier(v, strong, depth + 1),
    );
  }
  return false;
}

/**
 * Motifs `LIKE` dérivés de l'ADRESSE SEULE — jamais du nom.
 *
 * Ils ne servent qu'à BORNER ce qu'on rapatrie : le verdict d'appartenance
 * reste `carriesStrongIdentifier`. Deux formes, parce que l'incident
 * `fileNames` a montré que l'adresse voyage démantelée :
 *   · l'adresse telle quelle .................. `%jean.dupont@exemple.fr%`
 *   · ses fragments dans l'ordre .............. `%jean%dupont%exemple%fr%`
 *     (ce qui reconnaît `jean_dupont_exemple.fr_PROFIL.pdf`)
 *
 * `escapeLike` est appliqué à chaque fragment : une adresse contenant `_` —
 * courant — élargirait sinon la recherche toute seule.
 */
export function strongSearchPatterns(
  identity: ErasureIdentity,
  fp: SubjectFingerprint,
  escape: (v: string) => string,
): string[] {
  const out = new Set<string>();
  for (const email of identity.emails) {
    if (email.length >= 5) out.add(`%${escape(email)}%`);
  }
  for (const chunks of fp.emailChunks) {
    if (chunks.length >= 2) out.add(`%${chunks.map(escape).join('%')}%`);
  }
  return [...out];
}

/**
 * Motifs `LIKE` du NOM — pour la seule branche « homonyme probable », et
 * jamais pour décider d'un effacement. Bornés à des jetons d'au moins 4
 * caractères : « ali », « lee » remonteraient des pans entiers de la base
 * pour un signal qui ne se tranche pas.
 */
export function weakSearchPatterns(
  fp: SubjectFingerprint,
  escape: (v: string) => string,
): string[] {
  const out = new Set<string>();
  for (const slug of fp.slugs) if (slug.length >= 4) out.add(`%${escape(slug)}%`);
  for (const token of fp.nameTokens) if (token.length >= 4) out.add(`%${escape(token)}%`);
  return [...out];
}
