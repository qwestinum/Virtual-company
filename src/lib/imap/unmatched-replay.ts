/**
 * Rejeu des CV non traités (`imap_unmatched_cvs`) — cœur PARTAGÉ entre le
 * rejeu humain (`POST /api/imap/unmatched/[id]/replay`, C11) et le drain
 * automatique à la validation de la fiche de scoring (C4). Un seul chemin :
 * réservation conditionnelle `pending → replayed` AVANT tout effet, download
 * du binaire, `processEmailAttachment` TEL QUEL (mêmes gardes, mêmes claims
 * d'idempotence — jamais de double mail), journal. Sur échec, la ligne est
 * rendue re-rejouable (best-effort).
 *
 * INVARIANT : on ne rejoue JAMAIS vers une campagne sans fiche de scoring
 * validée. Sinon `processEmailAttachment` retomberait dans le branchement
 * `pending_sheet` dont l'upsert `(mailbox, uid, file_name)` no-operait sur la
 * ligne déjà consommée (`replayed`) — le CV disparaîtrait. Les deux appelants
 * vérifient la fiche AVANT d'appeler ce cœur.
 */
import type { ActiveCampaign } from '@/stores/campaigns-store';
import {
  listPendingSheetCvs,
  reserveUnmatchedReplay,
  revertUnmatchedReplay,
  type UnmatchedCvRow,
} from '@/lib/db/repos/imap-unmatched-cvs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getMailboxWithSecrets } from '@/lib/db/repos/mailboxes';
import { processEmailAttachment } from '@/lib/imap/poller';
import { RetryablePollError } from '@/lib/imap/poll-retry';
import { downloadArtifact } from '@/lib/storage/blob';

export type ReplayOutcome =
  | { kind: 'done' }
  /** Déjà rejoué/écarté (perdant d'une course) — rien à faire. */
  | { kind: 'already_consumed' }
  /** Ligne sans binaire (panne storage à la réception) — renvoi requis. */
  | { kind: 'binary_unavailable' }
  /** Binaire introuvable en Storage au download — ligne rendue re-rejouable. */
  | { kind: 'download_failed' }
  /** Traitement échoué — ligne rendue re-rejouable, claims anti-double-mail. */
  | { kind: 'failed'; retryable: boolean; message: string };

/**
 * Rejoue UNE ligne vers `campaign` (fiche validée exigée par l'appelant).
 * `actor` distingue le rejeu humain du drain système dans le journal.
 */
export async function replayUnmatchedCv(args: {
  row: UnmatchedCvRow;
  campaign: ActiveCampaign;
  actor: 'user' | 'system';
}): Promise<ReplayOutcome> {
  const { row, campaign, actor } = args;
  if (!row.storage_path) return { kind: 'binary_unavailable' };

  const mailbox = await getMailboxWithSecrets(row.mailbox_id);
  if (!mailbox) {
    return {
      kind: 'failed',
      retryable: false,
      message: `boîte ${row.mailbox_id} introuvable`,
    };
  }

  // Réservation AVANT tout effet de bord — un seul gagnant sous concurrence.
  const reserved = await reserveUnmatchedReplay(row.id, campaign.id);
  if (!reserved) return { kind: 'already_consumed' };

  const buffer = await downloadArtifact(row.storage_path);
  if (!buffer) {
    await revertUnmatchedReplay(row.id);
    return { kind: 'download_failed' };
  }

  try {
    await processEmailAttachment({
      mailbox,
      campaign,
      fileName: row.file_name,
      mime: row.mime,
      buffer,
      uid: row.uid,
      subject: row.subject ?? '',
      from: row.from_addr,
      matchSource: 'replay',
    });
  } catch (procErr) {
    // Échec (transitoire ou non) : re-rejouable — les claims d'idempotence
    // garantissent qu'un mail déjà parti ne repartira pas au prochain essai.
    await revertUnmatchedReplay(row.id);
    return {
      kind: 'failed',
      retryable: procErr instanceof RetryablePollError,
      message: procErr instanceof Error ? procErr.message : String(procErr),
    };
  }

  await appendJournalEntry({
    action: 'imap_unmatched_replayed',
    actor,
    campaignId: campaign.id,
    payload: {
      unmatchedId: row.id,
      mailboxId: row.mailbox_id,
      uid: row.uid,
      fileName: row.file_name,
      from: row.from_addr,
      reason: row.reason,
      trigger: actor === 'system' ? 'scoring_sheet_validated' : 'manual_replay',
    },
  }).catch((jErr) =>
    console.error('[imap-unmatched] journal replay KO', jErr),
  );

  return { kind: 'done' };
}

/** La campagne peut-elle recevoir un rejeu ? (pur, testé) */
export function canReceiveReplay(
  campaign: Pick<ActiveCampaign, 'status' | 'scoringSheet'>,
): boolean {
  return (
    campaign.status === 'active' && campaign.scoringSheet?.isValidated === true
  );
}

/**
 * DRAIN de la file `pending_sheet` d'une campagne (C4) — appelé en
 * fire-and-forget (`after()`) par les routes campagnes quand l'état persisté
 * est « active + fiche validée ». Idempotent (réservation conditionnelle par
 * ligne), séquentiel (jamais N analyses/envois concurrents), ne lève jamais :
 * un échec est loggé, la ligne reste `pending`, le prochain passage (nouvelle
 * sauvegarde de la campagne ou rejeu manuel) reprendra.
 */
export async function drainPendingSheetCvs(
  campaign: ActiveCampaign,
): Promise<void> {
  try {
    if (!canReceiveReplay(campaign)) return;
    const rows = await listPendingSheetCvs(campaign.id);
    if (rows.length === 0) return;
    console.log(
      `[imap-unmatched] drain pending_sheet ${campaign.id} : ${rows.length} CV en attente de fiche`,
    );
    for (const row of rows) {
      try {
        const outcome = await replayUnmatchedCv({
          row,
          campaign,
          actor: 'system',
        });
        if (outcome.kind !== 'done' && outcome.kind !== 'already_consumed') {
          console.error(
            `[imap-unmatched] drain ${campaign.id} uid=${row.uid} ${row.file_name} → ${outcome.kind}`,
            'message' in outcome ? outcome.message : '',
          );
        }
      } catch (err) {
        console.error(
          `[imap-unmatched] drain ${campaign.id} uid=${row.uid} KO`,
          err,
        );
      }
    }
  } catch (err) {
    // Colonne `reason` absente (migration C4 non appliquée) ou panne DB :
    // bruyant mais sans casser la sauvegarde de campagne qui nous a déclenchés.
    console.error(
      `[imap-unmatched] drain pending_sheet ${campaign.id} KO`,
      err,
    );
  }
}
