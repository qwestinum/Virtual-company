/**
 * Périmètre TECHNIQUE d'une demande, conservé avec sa trace — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §5.1 et §7.5.
 *
 * ⚠️ **NON BRANCHÉ à ce jour.** Aucun appelant : `requests.ts` n'écrit dans
 * `gdpr_erasure_requests.scope` que des COMPTEURS, et le contrôle ne rejoue
 * donc pas encore sur le périmètre historique. Le module est conservé parce
 * que le raisonnement ci-dessous a coûté un incident et ne se réécrit pas
 * deux fois — mais tant qu'il n'est pas câblé, un rejeu sur un périmètre vide
 * rend « contrôle sans objet » (`verify.ts`) et ne peut pas vérifier ce qu'il
 * ne retrouve plus. C'est honnête, ce n'est pas complet.
 *
 * ─── POURQUOI CONSERVER UN PÉRIMÈTRE ─────────────────────────────────────
 * Un effacement réussi rend la personne INTROUVABLE — c'est son objet. Un
 * rejeu qui repart de l'adresse ne retrouve donc plus rien, et un contrôle
 * qui ne porte que sur « ce qu'on retrouve aujourd'hui » ne porte sur rien :
 * il rend « aucune donnée trouvée » et un rapport d'apparence complète alors
 * qu'un résidu du premier passage est toujours là. C'est exactement ce qui
 * s'est produit sur `journal#594`.
 *
 * Le rejeu doit donc rejouer le contrôle sur le PÉRIMÈTRE HISTORIQUE de la
 * demande, pas sur ce qu'il redécouvre.
 *
 * ─── CE QU'ON CONSERVE, ET CE QU'ON NE CONSERVE PAS ──────────────────────
 * UNIQUEMENT des identifiants TECHNIQUES — ceux que la procédure conserve
 * déjà en base de propos délibéré (§5.3) et dont le contrôle de
 * ré-identification vérifie qu'ils ne mènent plus à personne. Les conserver
 * ici n'ajoute aucun risque de ré-identification : ils sont déjà là, et ils
 * ne désignent plus rien.
 *
 * JAMAIS l'adresse, le nom, le téléphone, ni un nom de fichier (qui est très
 * souvent construit sur l'un des trois). La liste est VÉRIFIÉE À LA
 * COMPILATION : un champ ajouté à `ErasureIdentity` sans décision explicite
 * ne compile pas. C'est la même garde que le squelette d'analyse — pour la
 * même raison : une liste blanche qu'on peut oublier de tenir n'en est pas une.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { ErasureIdentity } from '@/types/gdpr';

/** Les seuls champs d'identité que la trace a le droit de porter. */
export type TechnicalScope = Pick<
  ErasureIdentity,
  | 'analysisIds'
  | 'uids'
  | 'imapRefs'
  | 'campaignIds'
  | 'vivierIds'
  | 'briefIds'
  | 'validationIds'
  | 'linkTokens'
  | 'bookingIds'
  | 'artifactIds'
  | 'unmatchedIds'
  | 'storagePaths'
>;

/**
 * Décision EXPLICITE pour CHAQUE champ de `ErasureIdentity`. `true` = conservé
 * dans la trace ; `false` = jamais. Le type impose l'exhaustivité.
 */
const KEEP: Record<keyof ErasureIdentity, boolean> = {
  // Identité en clair — jamais. C'est précisément ce qu'on efface.
  emails: false,
  names: false,
  phones: false,
  // Un nom de fichier est très souvent construit sur l'adresse ou le nom
  // (`yvanbisseg_yahoo.fr_PROFIL.pdf`) : il n'est pas technique.
  fileNames: false,

  // Identifiants techniques, déjà conservés en base par décision (§5.3).
  analysisIds: true,
  uids: true,
  imapRefs: true,
  campaignIds: true,
  vivierIds: true,
  briefIds: true,
  validationIds: true,
  linkTokens: true,
  bookingIds: true,
  artifactIds: true,
  unmatchedIds: true,
  // Un chemin de stockage porte le nom de fichier. On le conserve quand même :
  // c'est le seul moyen de re-contrôler qu'un binaire a bien disparu, et le
  // fichier qu'il désigne n'existe plus. Il n'est PAS imprimé dans le rapport.
  storagePaths: true,
};

export function technicalScope(identity: ErasureIdentity): TechnicalScope {
  const out = {} as Record<string, unknown>;
  for (const [key, keep] of Object.entries(KEEP)) {
    if (keep) out[key] = identity[key as keyof ErasureIdentity];
  }
  return out as TechnicalScope;
}

/** Périmètre vide — repli quand aucune trace antérieure n'existe. */
export const EMPTY_TECHNICAL_SCOPE: TechnicalScope = {
  analysisIds: [],
  uids: [],
  imapRefs: [],
  campaignIds: [],
  vivierIds: [],
  briefIds: [],
  validationIds: [],
  linkTokens: [],
  bookingIds: [],
  artifactIds: [],
  unmatchedIds: [],
  storagePaths: [],
};

/**
 * Fusionne le périmètre HISTORIQUE dans l'identité résolue AUJOURD'HUI.
 *
 * L'union, jamais le remplacement : le passage d'aujourd'hui peut découvrir
 * des lignes qu'un premier passage avait manquées (c'est même le cas normal
 * d'un correctif), et le passage d'hier connaissait des lignes qu'on ne
 * retrouve plus. Le contrôle doit couvrir les deux.
 *
 * L'identité en clair (adresse, nom, téléphone) vient TOUJOURS du passage
 * courant : elle n'a jamais été conservée, et c'est voulu.
 */
export function mergeHistoricalScope(
  identity: ErasureIdentity,
  history: Partial<TechnicalScope>[],
): ErasureIdentity {
  const merged: ErasureIdentity = { ...identity };
  for (const past of history) {
    for (const key of Object.keys(EMPTY_TECHNICAL_SCOPE) as (keyof TechnicalScope)[]) {
      if (key === 'imapRefs') {
        merged.imapRefs = uniqRefs([...merged.imapRefs, ...(past.imapRefs ?? [])]);
      } else {
        const previous = (past[key] ?? []) as string[];
        merged[key] = [...new Set([...(merged[key] as string[]), ...previous])];
      }
    }
  }
  return merged;
}

function uniqRefs(
  refs: { mailboxId: string; uid: string }[],
): { mailboxId: string; uid: string }[] {
  const seen = new Set<string>();
  const out: { mailboxId: string; uid: string }[] = [];
  for (const r of refs) {
    const k = `${r.mailboxId} ${r.uid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Le périmètre historique apporte-t-il quelque chose ? Sert à le DIRE. */
export function scopeSize(scope: Partial<TechnicalScope>): number {
  return Object.values(scope).reduce<number>(
    (n, v) => n + (Array.isArray(v) ? v.length : 0),
    0,
  );
}
