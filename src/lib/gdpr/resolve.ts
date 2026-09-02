/**
 * Résolution de l'ENSEMBLE D'IDENTIFIANTS d'un candidat.
 * Procédure : docs/ops/purge-rgpd-candidat.md §7.3.
 *
 * ─── LA RÈGLE QUI GOUVERNE CE FICHIER ────────────────────────────────────
 * Une ligne entre dans le périmètre par un IDENTIFIANT (uid, identifiant
 * d'analyse, dossier de vivier, jeton de lien), par une ADRESSE, ou par un
 * TÉLÉPHONE. **Jamais par le nom.**
 *
 * Un nom n'est pas unique. Cibler dessus ferait effacer les données d'un
 * homonyme — le seul défaut de cet outil dont personne ne se remettrait, parce
 * qu'il est irréversible et qu'il frappe quelqu'un qui n'a rien demandé.
 *
 * Le nom sert quand même, mais UNIQUEMENT à l'intérieur du périmètre déjà
 * établi : caviarder « Jean Dupont » dans une ligne de journal dont on sait
 * déjà, par son uid, qu'elle concerne ce dossier. Une occurrence du même nom
 * ailleurs est SIGNALÉE au contrôle final comme homonyme probable, et laissée
 * intacte.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ PIÈGE À NE JAMAIS RÉINTRODUIRE — une liste d'identifiants VIDE.
 * Écrire `ids.length > 0 ? [{ op: 'in', … }] : []` produit, dans le cas vide,
 * une requête SANS AUCUN FILTRE : PostgREST rend alors TOUTE la table. Défaut
 * observé en recette le 02/09/2026 : la résolution d'UN candidat rapatriait
 * l'intégralité du vivier, dont les adresses et les noms venaient ensuite
 * élargir le périmètre de proche en proche — et la purge aurait supprimé tous
 * les dossiers.
 *
 * Le filtre `in` est donc TOUJOURS posé ; c'est `pageAllByText` qui
 * court-circuite sur une liste vide et rend `[]`. « Rien à chercher » doit
 * vouloir dire « rien », jamais « tout ».
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { analysisIdForValidation } from '@/lib/hitl/analysis-key';
import { escapeLike, pageAllByText } from '@/lib/gdpr/scan';
import type { ErasureIdentity } from '@/types/gdpr';
import type { CVApplication } from '@/types/cv-analysis';

/** `can_imap_<boîte>_<uid>` — la boîte peut contenir des `_`, on ancre sur la fin. */
const IMAP_ANALYSIS_ID = /^can_imap_(.+)_(\d+)$/u;

export type ResolveInput = {
  /** Adresses fournies par l'instruction. Normalisées ici. */
  emails: string[];
  /** Points d'entrée pour un dossier SANS adresse exploitable. */
  analysisIds?: string[];
  /** `<boîte>:<uid>` — même usage. */
  imapRefs?: { mailboxId: string; uid: string }[];
};

type AnalysisRow = {
  id: string;
  uid: string | null;
  campaign_id: string | null;
  candidate_name: string;
  candidate_email: string | null;
  file_name: string;
  vivier_candidate_id: string | null;
  application: CVApplication | null;
};

type VivierRow = {
  id: string;
  email: string;
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cv_path: string | null;
};

type BriefRow = {
  id: string;
  uid: string | null;
  candidate_email: string | null;
  candidate_name: string;
  campaign_id: string | null;
  task_id: string | null;
};

type ValidationRow = {
  id: string;
  campaign_id: string;
  candidate_name: string;
  candidate_email: string | null;
  payload: Record<string, unknown>;
};

type BookingRow = {
  id: string;
  link_token: string | null;
  attendee_email: string;
  attendee_name: string;
  attendee_phone: string | null;
  context: Record<string, unknown>;
};

type UnmatchedRow = {
  id: string;
  mailbox_id: string;
  uid: string;
  from_addr: string | null;
  file_name: string;
  storage_path: string | null;
};

type ArtifactMetaRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  storage_path: string | null;
  campaign_id: string | null;
  task_id: string | null;
};

export async function resolveIdentity(
  db: SupabaseClient,
  input: ResolveInput,
): Promise<ErasureIdentity> {
  const emails = uniq(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean));

  const acc: ErasureIdentity = {
    emails,
    names: [],
    phones: [],
    analysisIds: [...(input.analysisIds ?? [])],
    uids: [],
    imapRefs: [...(input.imapRefs ?? [])],
    campaignIds: [],
    fileNames: [],
    vivierIds: [],
    briefIds: [],
    validationIds: [],
    linkTokens: [],
    bookingIds: [],
    artifactIds: [],
    unmatchedIds: [],
    storagePaths: [],
  };

  // ── 1. Les analyses : la racine de tout le reste ────────────────────────
  // `candidate_email` GARDE LA CASSE DU CV (le code de lecture l'assume déjà,
  // cf. `getLatestAnalysisByEmail`) ⇒ `ilike`, jamais `eq`.
  const analyses: AnalysisRow[] = [];
  for (const email of emails) {
    analyses.push(
      ...(await pageAllByText<AnalysisRow>(db, 'candidate_analyses', ANALYSIS_SELECT, 'id', [
        { op: 'ilike', col: 'candidate_email', value: escapeLike(email) },
      ])),
    );
  }
  if (acc.analysisIds.length > 0) {
    analyses.push(
      ...(await pageAllByText<AnalysisRow>(db, 'candidate_analyses', ANALYSIS_SELECT, 'id', [
        { op: 'in', col: 'id', values: acc.analysisIds },
      ])),
    );
  }

  for (const a of dedupeById(analyses)) {
    push(acc.analysisIds, a.id);
    push(acc.uids, a.uid ?? a.id);
    push(acc.names, a.candidate_name);
    push(acc.campaignIds, a.campaign_id);
    push(acc.fileNames, a.file_name);
    push(acc.vivierIds, a.vivier_candidate_id);
    push(acc.phones, a.application?.candidate.phone ?? null);
    // Une analyse trouvée par un point d'entrée technique apporte son adresse.
    const mailFromRow = a.candidate_email?.trim().toLowerCase() ?? null;
    push(acc.emails, mailFromRow);
    const m = IMAP_ANALYSIS_ID.exec(a.id);
    if (m) pushRef(acc.imapRefs, { mailboxId: m[1]!, uid: m[2]! });
  }

  // ── 2. Le vivier — clé de dédup = l'adresse, normalisée en base ──────────
  const vivier = await pageAllByText<VivierRow>(
    db,
    'vivier_candidates',
    'id, email, nom, prenom, telephone, cv_path',
    'id',
    [{ op: 'in', col: 'email', values: emails }],
  );
  const vivierById = await pageAllByText<VivierRow>(
    db,
    'vivier_candidates',
    'id, email, nom, prenom, telephone, cv_path',
    'id',
    [{ op: 'in', col: 'id', values: acc.vivierIds }],
  );
  for (const v of [...vivier, ...vivierById]) {
    push(acc.vivierIds, v.id);
    push(acc.emails, v.email);
    push(acc.names, [v.prenom, v.nom].filter(Boolean).join(' '));
    push(acc.names, v.nom);
    push(acc.phones, v.telephone);
    push(acc.storagePaths, v.cv_path);
  }

  // ── 3. Les briefings d'entretien ────────────────────────────────────────
  const briefs: BriefRow[] = [];
  for (const email of [...acc.emails]) {
    briefs.push(
      ...(await pageAllByText<BriefRow>(db, 'interview_briefs', BRIEF_SELECT, 'id', [
        { op: 'ilike', col: 'candidate_email', value: escapeLike(email) },
      ])),
    );
  }
  if (acc.uids.length > 0) {
    briefs.push(
      ...(await pageAllByText<BriefRow>(db, 'interview_briefs', BRIEF_SELECT, 'id', [
        { op: 'in', col: 'uid', values: acc.uids },
      ])),
    );
  }
  for (const b of dedupeById(briefs)) {
    push(acc.briefIds, b.id);
    push(acc.names, b.candidate_name);
    push(acc.emails, b.candidate_email?.toLowerCase() ?? null);
    push(acc.campaignIds, b.campaign_id ?? b.task_id);
  }

  // ── 4. La file de validation humaine ────────────────────────────────────
  // Rattachement par ADRESSE (chemin direct) et par uid porté dans la charge
  // utile — un dossier peut avoir été mis en file avant d'avoir une adresse.
  const validations: ValidationRow[] = [];
  for (const email of [...acc.emails]) {
    validations.push(
      ...(await pageAllByText<ValidationRow>(db, 'pending_validations', VALIDATION_SELECT, 'id', [
        { op: 'ilike', col: 'candidate_email', value: escapeLike(email) },
      ])),
    );
  }
  if (acc.campaignIds.length > 0) {
    const inCampaigns = await pageAllByText<ValidationRow>(
      db,
      'pending_validations',
      VALIDATION_SELECT,
      'id',
      [{ op: 'in', col: 'campaign_id', values: acc.campaignIds }],
    );
    for (const v of inCampaigns) {
      const uid = typeof v.payload?.uid === 'string' ? v.payload.uid : null;
      const derived = analysisIdForValidation({ id: v.id, payload: v.payload });
      if (
        (uid && acc.uids.includes(uid)) ||
        (derived && acc.analysisIds.includes(derived))
      ) {
        validations.push(v);
      }
    }
  }
  for (const v of dedupeById(validations)) {
    push(acc.validationIds, v.id);
    push(acc.names, v.candidate_name);
    push(acc.emails, v.candidate_email?.toLowerCase() ?? null);
    push(acc.campaignIds, v.campaign_id);
  }

  // ── 5. Réservation native : cibles → liens → réservations ───────────────
  const targets = await pageAllByText<{ id: string; external_ref: string }>(
    db,
    'sched_targets',
    'id, external_ref',
    'id',
    [{ op: 'in', col: 'external_ref', values: acc.campaignIds }],
  );
  if (targets.length > 0) {
    const links = await pageAllByText<{ token: string; context: Record<string, unknown>; display: Record<string, unknown> }>(
      db,
      'sched_booking_links',
      'token, context, display',
      'token',
      [{ op: 'in', col: 'target_id', values: targets.map((t) => t.id) }],
    );
    for (const l of links) {
      const analysisId = typeof l.context?.analysisId === 'string' ? l.context.analysisId : null;
      const attendee = typeof l.display?.attendeeEmail === 'string' ? l.display.attendeeEmail.toLowerCase() : null;
      const scoped =
        (analysisId !== null && acc.analysisIds.includes(analysisId)) ||
        (attendee !== null && acc.emails.includes(attendee));
      if (scoped) push(acc.linkTokens, l.token);
    }
  }
  const bookings: BookingRow[] = [];
  for (const email of [...acc.emails]) {
    bookings.push(
      ...(await pageAllByText<BookingRow>(db, 'sched_bookings', BOOKING_SELECT, 'id', [
        { op: 'ilike', col: 'attendee_email', value: escapeLike(email) },
      ])),
    );
  }
  if (acc.linkTokens.length > 0) {
    bookings.push(
      ...(await pageAllByText<BookingRow>(db, 'sched_bookings', BOOKING_SELECT, 'id', [
        { op: 'in', col: 'link_token', values: acc.linkTokens },
      ])),
    );
  }
  for (const b of dedupeById(bookings)) {
    push(acc.bookingIds, b.id);
    push(acc.names, b.attendee_name);
    push(acc.emails, b.attendee_email.toLowerCase());
    push(acc.phones, b.attendee_phone);
    push(acc.linkTokens, b.link_token);
  }

  // ── 6. File de résilience IMAP ──────────────────────────────────────────
  const unmatched: UnmatchedRow[] = [];
  for (const email of [...acc.emails]) {
    unmatched.push(
      ...(await pageAllByText<UnmatchedRow>(db, 'imap_unmatched_cvs', UNMATCHED_SELECT, 'id', [
        { op: 'ilike', col: 'from_addr', value: `%${escapeLike(email)}%` },
      ])),
    );
  }
  for (const ref of [...acc.imapRefs]) {
    unmatched.push(
      ...(await pageAllByText<UnmatchedRow>(db, 'imap_unmatched_cvs', UNMATCHED_SELECT, 'id', [
        { op: 'eq', col: 'mailbox_id', value: ref.mailboxId },
        { op: 'eq', col: 'uid', value: ref.uid },
      ])),
    );
  }
  for (const u of dedupeById(unmatched)) {
    push(acc.unmatchedIds, u.id);
    push(acc.storagePaths, u.storage_path);
    pushRef(acc.imapRefs, { mailboxId: u.mailbox_id, uid: u.uid });
  }

  // ── 7. Métadonnées d'artefacts ──────────────────────────────────────────
  // Ids DÉTERMINISTES d'abord (le poller et le chat les fabriquent), puis
  // balayage des campagnes du candidat avec rattachement par uid ou adresse.
  for (const ref of [...acc.imapRefs]) {
    push(acc.artifactIds, `art_imap_cvfile_${ref.mailboxId}_${ref.uid}`);
    push(acc.artifactIds, `art_imap_cvabandon_${ref.mailboxId}_${ref.uid}`);
  }
  for (const uid of acc.uids) push(acc.artifactIds, `art_cv_${uid}`);

  const metas = await pageAllByText<ArtifactMetaRow>(
    db,
    'artifacts_meta',
    'id, name, metadata, storage_path, campaign_id, task_id',
    'id',
    [{ op: 'in', col: 'campaign_id', values: acc.campaignIds }],
  );
  const metasTasks = await pageAllByText<ArtifactMetaRow>(
    db,
    'artifacts_meta',
    'id, name, metadata, storage_path, campaign_id, task_id',
    'id',
    [{ op: 'in', col: 'task_id', values: acc.campaignIds }],
  );
  for (const m of dedupeById([...metas, ...metasTasks])) {
    const uid = typeof m.metadata?.uid === 'string' ? m.metadata.uid : null;
    const mail =
      typeof m.metadata?.candidateEmail === 'string'
        ? m.metadata.candidateEmail.toLowerCase()
        : null;
    const from = typeof m.metadata?.from === 'string' ? m.metadata.from.toLowerCase() : null;
    const scoped =
      acc.artifactIds.includes(m.id) ||
      (uid !== null && acc.uids.includes(uid)) ||
      (mail !== null && acc.emails.includes(mail)) ||
      (from !== null && acc.emails.some((e) => from.includes(e))) ||
      acc.fileNames.includes(m.name);
    if (scoped) {
      push(acc.artifactIds, m.id);
      push(acc.storagePaths, m.storage_path);
    }
  }

  // Un id déterministe fabriqué ci-dessus peut ne correspondre à AUCUNE ligne :
  // c'est sans conséquence (le delete no-ope), et le garder évite un aller-retour.
  return normalize(acc);
}

const ANALYSIS_SELECT =
  'id, uid, campaign_id, candidate_name, candidate_email, file_name, vivier_candidate_id, application';
const BRIEF_SELECT = 'id, uid, candidate_email, candidate_name, campaign_id, task_id';
const VALIDATION_SELECT = 'id, campaign_id, candidate_name, candidate_email, payload';
const BOOKING_SELECT =
  'id, link_token, attendee_email, attendee_name, attendee_phone, context';
const UNMATCHED_SELECT = 'id, mailbox_id, uid, from_addr, file_name, storage_path';

// ─── Petits utilitaires ────────────────────────────────────────────────────

function push(list: string[], value: string | null | undefined): void {
  const v = value?.trim();
  if (v && !list.includes(v)) list.push(v);
}

function pushRef(
  list: { mailboxId: string; uid: string }[],
  ref: { mailboxId: string; uid: string },
): void {
  if (!list.some((r) => r.mailboxId === ref.mailboxId && r.uid === ref.uid)) list.push(ref);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x.length > 0))];
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

function normalize(acc: ErasureIdentity): ErasureIdentity {
  return {
    ...acc,
    emails: uniq(acc.emails.map((e) => e.toLowerCase())),
    names: uniq(acc.names),
    phones: uniq(acc.phones),
  };
}
