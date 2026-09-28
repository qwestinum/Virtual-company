/**
 * Repo Supabase — messages au candidat après décision (`candidate_feedback`).
 * Branche feat/feedback-candidat (28/09/2026).
 *
 * AJOUT SEUL, à une exception près tenue par la base : le statut d'envoi se
 * pose UNE fois (`pending` → final). Ce module n'expose aucune autre écriture ;
 * seule la purge RGPD supprime, par son propre chemin (`src/lib/gdpr`).
 */

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { CandidateFeedbackRow } from '@/lib/db/types';
import type {
  CandidateFeedback,
  FeedbackKind,
  FeedbackMailStatus,
  SelfFeedbackChannel,
} from '@/types/candidate-feedback';

const TABLE = 'candidate_feedback';
/** Taille des lots d'identifiants par requête (URL PostgREST bornée). */
const ID_CHUNK = 200;

/** Mapping row → domaine (pur, exporté pour test). */
export function candidateFeedbackRowToDomain(row: CandidateFeedbackRow): CandidateFeedback {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    uid: row.uid,
    campaignId: row.campaign_id,
    kind: row.kind,
    channel: row.channel,
    channelNote: row.channel_note,
    subject: row.subject,
    body: row.body,
    mailStatus: row.mail_status,
    sentAt: row.sent_at,
    authorUserId: row.author_user_id,
    authorEmail: row.author_email,
    createdAt: row.created_at,
  };
}

type Common = {
  analysisId: string;
  uid: string;
  campaignId: string | null;
  kind: FeedbackKind;
  authorUserId: string | null;
  authorEmail: string | null;
};

async function insertRow(row: Record<string, unknown>, where: string): Promise<CandidateFeedback> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
  if (error) throw new Error(`${where}: ${error.message}`);
  return candidateFeedbackRowToDomain(data as CandidateFeedbackRow);
}

function commonRow(input: Common): Record<string, unknown> {
  return {
    analysis_id: input.analysisId,
    uid: input.uid,
    campaign_id: input.campaignId,
    kind: input.kind,
    author_user_id: input.authorUserId,
    author_email: input.authorEmail,
  };
}

/**
 * Écrit l'intention d'envoi AVANT l'envoi (`pending`) : objet et corps tels
 * que relus à l'écran. Le statut final se pose ensuite par `settleFeedbackMail`.
 */
export async function insertPendingFeedbackMail(
  input: Common & { subject: string; body: string },
): Promise<CandidateFeedback> {
  return insertRow(
    {
      ...commonRow(input),
      channel: 'mail',
      subject: input.subject,
      body: input.body,
      mail_status: 'pending',
    },
    'insertPendingFeedbackMail',
  );
}

/** « Je préviens moi-même » : aucun envoi, aucune copie du message. */
export async function insertSelfFeedback(
  input: Common & { channel: SelfFeedbackChannel; note: string | null },
): Promise<CandidateFeedback> {
  return insertRow(
    { ...commonRow(input), channel: input.channel, channel_note: input.note },
    'insertSelfFeedback',
  );
}

/**
 * Pose le statut FINAL d'un envoi — une seule fois : l'update est conditionné
 * à `pending` (et le déclencheur refuse toute autre transition). `false` : la
 * ligne n'était plus `pending` (statut déjà posé).
 */
export async function settleFeedbackMail(
  id: string,
  status: Exclude<FeedbackMailStatus, 'pending'>,
): Promise<boolean> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      mail_status: status,
      ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    })
    .eq('id', id)
    .eq('mail_status', 'pending')
    .select('id');
  if (error) throw new Error(`settleFeedbackMail: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Tous les messages des analyses données, du plus ANCIEN au plus récent.
 * EXHAUSTIF : lots d'identifiants paginés en keyset sur la PK (audit C8).
 */
export async function listFeedbackByAnalyses(
  analysisIds: string[],
): Promise<CandidateFeedback[]> {
  const ids = [...new Set(analysisIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const supabase = requireServerSupabase();
  const out: CandidateFeedback[] = [];
  for (const batch of chunk(ids, ID_CHUNK)) {
    const rows = await fetchAllKeyset<CandidateFeedbackRow>({
      fetchPage: async (afterId, limit) => {
        let q = supabase
          .from(TABLE)
          .select('*')
          .in('analysis_id', batch)
          .order('id', { ascending: true })
          .limit(limit);
        if (afterId !== null) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw new Error(`listFeedbackByAnalyses: ${error.message}`);
        return (data ?? []) as CandidateFeedbackRow[];
      },
      cursorOf: (row) => row.id,
    });
    out.push(...rows.map(candidateFeedbackRowToDomain));
  }
  return out.sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}
