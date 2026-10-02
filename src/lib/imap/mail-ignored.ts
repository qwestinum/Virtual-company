/**
 * « Aucun mail vu ne disparaît sans un mot » — PUR, testé.
 *
 * Incident S2I du 01/10/2026 : un mail de test n'a laissé AUCUNE trace, et il
 * a fallu des requêtes en base et une connexion IMAP pour comprendre ce que la
 * relève avait vu. Désormais chaque mail que la relève LIT et ne transforme
 * pas en candidature laisse une entrée `imap_mail_ignored`, avec une raison
 * prise dans une liste FERMÉE.
 *
 * La charge ne porte que l'identifiant de la boîte, l'uid et la raison :
 * jamais l'objet, jamais l'expéditeur, jamais un nom. Ce journal compte et
 * explique ; le détail d'un cas reste dans les traces dédiées qui existaient
 * déjà (`imap_no_campaign_match`, `imap_email_no_cv`…), qu'on ne retire pas.
 *
 * Ce qui n'est PAS un mail ignoré, et pourquoi :
 *   · un uid déjà résolu que le serveur RE-présente (Gmail rend le dernier
 *     message quand la plage commence après lui) : ce n'est pas un nouveau
 *     mail, le tracer écrirait une ligne par minute ;
 *   · un mail SOUS la ligne de départ : il n'est jamais lu, par conception —
 *     on ne peut donc pas en dire un par un. La ligne de départ en donne le
 *     NOMBRE au moment où elle est posée (`countBelowBaseline`).
 */

import type { JournalEntryInput } from '@/lib/db/repos/journal';

export const IGNORED_MAIL_REASONS = [
  'no_attachment',
  'unsupported_attachment',
  'no_campaign_match',
  'campaign_not_associated',
  'campaign_inactive',
  'ambiguous_campaign',
  'orphan_campaign',
  'unparseable',
] as const;

export type IgnoredMailReason = (typeof IGNORED_MAIL_REASONS)[number];

export const IGNORED_MAIL_ACTION = 'imap_mail_ignored';

/** Libellés de l'écran (fiche de la boîte). */
export const IGNORED_MAIL_LABEL: Record<IgnoredMailReason, string> = {
  no_attachment: 'sans CV en pièce jointe',
  unsupported_attachment: 'CV dans un format non lu (.doc)',
  no_campaign_match: 'aucune référence de campagne',
  campaign_not_associated: 'campagne non associée à cette boîte',
  campaign_inactive: 'campagne non active',
  ambiguous_campaign: 'plusieurs campagnes citées',
  orphan_campaign: 'campagne supprimée',
  unparseable: 'message illisible',
};

export function ignoredMailEntry(
  mailboxId: string,
  uid: number | string | undefined,
  reason: IgnoredMailReason,
): JournalEntryInput {
  return {
    action: IGNORED_MAIL_ACTION,
    actor: 'imap_poller',
    campaignId: null,
    payload: { mailboxId, uid: uid === undefined ? null : String(uid), reason },
  };
}

/** Référence de campagne au format produit par ORQA (`CAMP-2026-199`, `CAMP-1234`). */
const CAMPAIGN_REF = /\bCAMP-\d{4}(?:-\d{2,})?\b/giu;

/**
 * Références de campagne citées dans le texte qui ne sont PAS associées à la
 * boîte. Sert à distinguer « aucune référence » de « une référence, mais
 * d'une campagne que cette boîte ne relève pas » — l'UID 2041 du 01/10 était
 * le second cas, et la trace affirmait le premier.
 */
export function foreignCampaignRefs(
  texts: ReadonlyArray<string | null | undefined>,
  associatedIds: readonly string[],
): string[] {
  const associated = new Set(associatedIds.map((id) => id.toUpperCase()));
  const found: string[] = [];
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(CAMPAIGN_REF)) {
      const ref = m[0].toUpperCase();
      if (!associated.has(ref) && !found.includes(ref)) found.push(ref);
    }
  }
  return found;
}

/** Motif d'un mail qu'aucune campagne de la boîte ne réclame. */
export function unmatchedReason(foreignRefs: readonly string[]): IgnoredMailReason {
  return foreignRefs.length > 0 ? 'campaign_not_associated' : 'no_campaign_match';
}

/**
 * Nombre de messages laissés SOUS la ligne de départ quand elle est posée :
 * tout le dossier, moins ce qui est au-dessus. Null si le serveur n'a pas
 * donné le nombre de messages — on n'invente pas.
 */
export function countBelowBaseline(input: {
  exists: number | null;
  baseline: number;
  uidsSinceConnection: readonly number[];
}): number | null {
  if (input.exists === null || !Number.isFinite(input.exists)) return null;
  const above = input.uidsSinceConnection.filter((u) => u > input.baseline).length;
  return Math.max(0, input.exists - above);
}

export type MailboxActivity = {
  /** Mails lus par la relève sur la fenêtre (= candidatures + ignorés). */
  seen: number;
  created: number;
  ignored: number;
  lastIgnoredReason: IgnoredMailReason | null;
  lastIgnoredAt: string | null;
};

/**
 * Activité d'une boîte, lue dans le journal — aucun cache. Une candidature =
 * un `imap_cv_analyzed` (un mail produit UNE candidature), un ignoré = un
 * `imap_mail_ignored`. Les lignes d'autres boîtes ou actions sont écartées.
 */
export function mailboxActivity(
  mailboxId: string,
  rows: ReadonlyArray<{ action: string; created_at: string; payload: Record<string, unknown> }>,
): MailboxActivity {
  const activity: MailboxActivity = {
    seen: 0,
    created: 0,
    ignored: 0,
    lastIgnoredReason: null,
    lastIgnoredAt: null,
  };
  for (const row of rows) {
    if (row.payload?.mailboxId !== mailboxId) continue;
    if (row.action === 'imap_cv_analyzed') activity.created++;
    else if (row.action === IGNORED_MAIL_ACTION) {
      activity.ignored++;
      const reason = row.payload.reason;
      const known = (IGNORED_MAIL_REASONS as readonly string[]).includes(String(reason));
      if (known && (activity.lastIgnoredAt === null || row.created_at > activity.lastIgnoredAt)) {
        activity.lastIgnoredAt = row.created_at;
        activity.lastIgnoredReason = reason as IgnoredMailReason;
      }
    }
  }
  activity.seen = activity.created + activity.ignored;
  return activity;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** « il y a 3 min », « il y a 2 h », « il y a 4 j ». */
export function relativeAge(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/**
 * La ligne de la fiche : « dernière relève : il y a 3 min · 12 mails vus ·
 * 2 candidatures créées · 10 ignorés (dernier : sans CV en pièce jointe) ».
 * Le chiffre zéro est écrit : « 0 mail vu » dit que la relève passe et ne
 * trouve rien, ce qui est précisément ce qu'on cherchait à savoir le 01/10.
 */
export function describeMailboxActivity(
  activity: MailboxActivity,
  lastPolledAt: string | null,
  windowDays: number,
  now: Date,
): string {
  const parts = [
    `dernière relève : ${lastPolledAt ? relativeAge(lastPolledAt, now) : 'jamais'}`,
    `${plural(activity.seen, 'mail vu', 'mails vus')} en ${windowDays} j`,
    plural(activity.created, 'candidature créée', 'candidatures créées'),
  ];
  let ignored = plural(activity.ignored, 'ignoré', 'ignorés');
  if (activity.lastIgnoredReason) ignored += ` (dernier : ${IGNORED_MAIL_LABEL[activity.lastIgnoredReason]})`;
  parts.push(ignored);
  return parts.join(' · ');
}
