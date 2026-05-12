/**
 * Poller IMAP — détection automatique de nouveaux CV (Session 5 round 5).
 *
 * Pour chaque mailbox active :
 *   1. Connexion IMAP (imapflow)
 *   2. Récupération des messages avec UID > last_uid_seen
 *   3. Pour chaque message :
 *      - parsing via mailparser
 *      - matching sur le subject (insensible casse) contre les
 *        campaignIds associés à la mailbox
 *      - extraction des pièces jointes PDF/DOCX
 *      - pour chaque PJ matchée : insert journal `imap_cv_received`,
 *        analyse via executeCVAnalyzer, upload artifact, journal
 *        `imap_cv_analyzed` ou `imap_cv_failed`
 *   4. Mise à jour last_uid_seen + last_polled_at + last_error
 *
 * Le poller est appelé par le scheduler toutes les 30s. Une exécution
 * échouée pour une mailbox n'affecte pas les autres (try/catch par
 * mailbox). Les UIDs sont notre seul mécanisme anti-doublon : on ne
 * marque jamais les messages comme \Seen côté serveur pour ne pas
 * modifier l'état de la boîte client.
 */

import { simpleParser } from 'mailparser';

import { fdpToCVCriteria } from '@/lib/agents/fdp-to-criteria';
import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { executeCVAnalyzer } from '@/lib/agents/server/cv-analyzer-execute';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
} from '@/lib/agents/cv-report-render';
import { decryptCredential } from '@/lib/crypto/mailbox-credentials';
import { dispatchImapCandidateOutreach } from '@/lib/imap/outreach';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listCampaignsForMailbox,
  listEnabledMailboxesWithSecrets,
  updateMailboxPollState,
  type MailboxRow,
} from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { openConnection } from '@/lib/imap/client';
import { uploadArtifact } from '@/lib/storage/blob';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import {
  CVAnalysisResultSchema,
  DEFAULT_CV_THRESHOLD,
} from '@/types/cv-analysis';

/**
 * MIME types acceptés par le poller. Alignés sur ce que
 * `extractCVText` sait réellement parser — pas la liste plus large
 * acceptée par la route /api/cv-analyzer (qui plante au moment de
 * l'extraction sur .doc binaire). Inclure des formats non extractables
 * créerait des entrées imap_cv_failed inutiles à chaque mail.
 *
 * Étendre cette liste : ajouter le format dans extractCVText d'abord,
 * sinon les CV seront marqués comme reçus puis échoués.
 */
const PDF_MIMES = new Set([
  'application/pdf',
  'application/x-pdf',
]);

function isCvMime(mime: string | undefined | null): boolean {
  if (!mime) return false;
  return PDF_MIMES.has(mime.toLowerCase());
}

function matchCampaignInSubject(
  subject: string,
  candidateIds: string[],
): string | null {
  const haystack = subject.toLowerCase();
  for (const id of candidateIds) {
    if (haystack.includes(id.toLowerCase())) return id;
  }
  return null;
}

export type PollOutcome = {
  mailboxId: string;
  processed: number; // CVs traités avec succès
  matched: number;   // emails matchés (qu'ils aient été analysés ou non)
  errors: number;
  newLastUid: string | null;
  /**
   * True si on a sauté le poll parce que la mailbox était déjà en
   * cours de traitement (mutex anti-overlap, cf. `inflight`).
   */
  skipped?: boolean;
};

/**
 * Set en mémoire des mailboxes actuellement en cours de polling.
 * Garde-fou contre l'overlap : `setInterval` peut lancer un tick #2
 * alors que #1 n'a pas fini (IMAP + extraction + LLM dépassent
 * facilement les 30s du cycle). Sans ce garde, deux polls liraient
 * le même `last_uid_seen` simultanément et retraiteraient les
 * mêmes UIDs.
 *
 * Stocké sur globalThis pour survivre au hot-reload Next.js dev
 * (cf. scheduler.ts pour la même technique).
 */
declare global {
  /* eslint-disable-next-line no-var */
  var __imapInflightMailboxes__: Set<string> | undefined;
}
const inflight: Set<string> =
  globalThis.__imapInflightMailboxes__ ?? new Set<string>();
globalThis.__imapInflightMailboxes__ = inflight;

/**
 * Poll une mailbox unique. Capture tout ce qu'on rencontre dans la
 * table journal pour audit. Met à jour `last_polled_at`, `last_uid_seen`,
 * `last_error` dans tous les cas.
 */
export async function pollMailbox(mailbox: MailboxRow): Promise<PollOutcome> {
  const outcome: PollOutcome = {
    mailboxId: mailbox.id,
    processed: 0,
    matched: 0,
    errors: 0,
    newLastUid: mailbox.last_uid_seen,
  };

  // Anti-overlap : on saute si un autre tick polle déjà cette mailbox.
  // Le scheduler relancera dans 30s, on aura toujours pris la suite.
  if (inflight.has(mailbox.id)) {
    return { ...outcome, skipped: true };
  }
  inflight.add(mailbox.id);
  try {
    return await pollMailboxImpl(mailbox, outcome);
  } finally {
    inflight.delete(mailbox.id);
  }
}

async function pollMailboxImpl(
  mailbox: MailboxRow,
  outcome: PollOutcome,
): Promise<PollOutcome> {
  let password: string;
  try {
    password = decryptCredential(mailbox.encrypted_password);
  } catch (err) {
    await updateMailboxPollState(mailbox.id, {
      lastError: `decryption_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    outcome.errors += 1;
    return outcome;
  }

  // Liste des campagnes associées à cette mailbox (pour matching subject).
  let associatedIds: string[];
  try {
    associatedIds = await listCampaignsForMailbox(mailbox.id);
  } catch (err) {
    await updateMailboxPollState(mailbox.id, {
      lastError: `db_assoc_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    outcome.errors += 1;
    return outcome;
  }

  if (associatedIds.length === 0) {
    // Mailbox enabled mais sans campagne — on note juste le poll
    // (preuve qu'on a fait le travail, pas d'erreur).
    await updateMailboxPollState(mailbox.id, { lastError: null });
    return outcome;
  }

  // Cache des campagnes actives pour ne pas re-fetcher à chaque CV.
  let campaignsById: Map<string, ActiveCampaign>;
  try {
    const all = await listCampaigns();
    campaignsById = new Map(all.map((c) => [c.id, c]));
  } catch (err) {
    await updateMailboxPollState(mailbox.id, {
      lastError: `db_campaigns_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    outcome.errors += 1;
    return outcome;
  }

  let client;
  try {
    client = await openConnection({
      host: mailbox.imap_host,
      port: mailbox.imap_port,
      secure: mailbox.imap_ssl,
      user: mailbox.user_email,
      password,
    });
  } catch (err) {
    await updateMailboxPollState(mailbox.id, {
      lastError: `connect_failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    outcome.errors += 1;
    return outcome;
  }

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Range "fromUid:*" pour ne récupérer que ce qui dépasse le
      // dernier UID vu. Si jamais vu, on part de "1:*" mais on
      // borne l'analyse à un volume raisonnable (cf. break ci-dessous).
      const fromUid = mailbox.last_uid_seen
        ? `${Number(mailbox.last_uid_seen) + 1}:*`
        : '1:*';
      const previousLastUid = mailbox.last_uid_seen
        ? Number(mailbox.last_uid_seen)
        : 0;
      let maxUidSeen = previousLastUid;

      // Garde-fou : si la mailbox est neuve (last_uid_seen null) et
      // contient déjà 10 000 messages anciens, on ne veut pas tous
      // les analyser. On limite à 50 messages par poll initial.
      // Lors des polls suivants, on remontera incrémentalement.
      const HARD_LIMIT_PER_POLL = 50;
      let inspected = 0;

      for await (const message of client.fetch(
        fromUid,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        if (inspected >= HARD_LIMIT_PER_POLL) break;
        inspected += 1;

        const uid = message.uid;
        // Garde-fou anti-retraitement (Round 5 fix) : Gmail renvoie le
        // dernier message même si le range start dépasse uidNext
        // (sémantique IMAP du `*` quand la borne basse dépasse le
        // max). Sans ce filtre, on retraite le même UID à chaque poll
        // jusqu'à ce qu'un nouveau message arrive. On compare
        // strictement à l'UID que l'on avait AVANT ce poll.
        if (typeof uid === 'number') {
          if (uid <= previousLastUid) continue;
          if (uid > maxUidSeen) maxUidSeen = uid;
        }

        // Parsing du message complet pour extraire subject + PJ.
        if (!message.source) continue;
        let parsed;
        try {
          parsed = await simpleParser(message.source);
        } catch (err) {
          outcome.errors += 1;
          await appendJournalEntry({
            action: 'imap_parse_failed',
            actor: 'imap_poller',
            payload: {
              mailboxId: mailbox.id,
              uid,
              error: err instanceof Error ? err.message : String(err),
            },
          }).catch(() => {});
          continue;
        }

        const subject = parsed.subject ?? '';
        const matchedCampaignId = matchCampaignInSubject(subject, associatedIds);
        if (!matchedCampaignId) continue;

        const campaign = campaignsById.get(matchedCampaignId);
        if (!campaign) {
          // Association orpheline (la campagne a été supprimée mais
          // pas la jointure). On log et on saute.
          await appendJournalEntry({
            action: 'imap_orphan_association',
            actor: 'imap_poller',
            campaignId: matchedCampaignId,
            payload: { mailboxId: mailbox.id, uid, subject },
          }).catch(() => {});
          continue;
        }

        // Extraction des PJ exploitables.
        const allAttachments = parsed.attachments ?? [];
        const cvAttachments = allAttachments.filter((a) =>
          isCvMime(a.contentType),
        );
        if (cvAttachments.length === 0) {
          await appendJournalEntry({
            action: 'imap_email_no_cv',
            actor: 'imap_poller',
            campaignId: matchedCampaignId,
            payload: {
              mailboxId: mailbox.id,
              uid,
              subject,
              from: parsed.from?.text ?? null,
              // Liste explicite des PJ rejetées : aide à diagnostiquer
              // quand le DRH envoie un .doc et se demande pourquoi
              // « rien ne se passe ». Le retour clair pointe vers
              // « renvoyez en PDF ».
              rejectedAttachments: allAttachments.map((a) => ({
                filename: a.filename ?? null,
                mime: a.contentType ?? null,
              })),
            },
          }).catch(() => {});
          continue;
        }

        outcome.matched += 1;

        for (const att of cvAttachments) {
          const fileName = att.filename ?? `cv-${uid}.pdf`;
          await processEmailAttachment({
            mailbox,
            campaign,
            fileName,
            mime: att.contentType ?? 'application/pdf',
            buffer: att.content,
            uid: String(uid),
            subject,
            from: parsed.from?.text ?? null,
          })
            .then(() => {
              outcome.processed += 1;
            })
            .catch(async (err) => {
              outcome.errors += 1;
              await appendJournalEntry({
                action: 'imap_cv_failed',
                actor: 'imap_poller',
                campaignId: matchedCampaignId,
                payload: {
                  mailboxId: mailbox.id,
                  uid: String(uid),
                  fileName,
                  error: err instanceof Error ? err.message : String(err),
                },
              }).catch(() => {});
            });
        }
      }

      outcome.newLastUid = maxUidSeen > 0 ? String(maxUidSeen) : outcome.newLastUid;
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  await updateMailboxPollState(mailbox.id, {
    lastUidSeen: outcome.newLastUid ?? undefined,
    lastError: null,
  });
  return outcome;
}

async function processEmailAttachment(args: {
  mailbox: MailboxRow;
  campaign: ActiveCampaign;
  fileName: string;
  mime: string;
  buffer: Buffer;
  uid: string;
  subject: string;
  from: string | null;
}): Promise<void> {
  const { mailbox, campaign, fileName, mime, buffer, uid, subject, from } =
    args;
  const isTaskOwner = campaign.id.startsWith('TASK-');

  // Journal — received (analyse en cours)
  await appendJournalEntry({
    action: 'imap_cv_received',
    actor: 'imap_poller',
    campaignId: isTaskOwner ? null : campaign.id,
    payload: {
      mailboxId: mailbox.id,
      uid,
      fileName,
      subject,
      from,
      taskId: isTaskOwner ? campaign.id : undefined,
    },
  });

  // Convertit le Buffer en File pour extractCVText (qui attend File).
  const file = new File([new Uint8Array(buffer)], fileName, { type: mime });
  let extracted;
  try {
    extracted = await extractCVText(file);
  } catch (err) {
    const code = err instanceof CVExtractError ? err.code : 'extract_failed';
    throw new Error(`extract_failed: ${code} — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Critères depuis la FDP de la campagne + scoring sheet éventuelle.
  const criteria = fdpToCVCriteria(campaign.fdp);
  if (campaign.scoringSheet?.isValidated) {
    criteria.scoringSheet = campaign.scoringSheet;
  }

  const output = await executeCVAnalyzer({
    taskId: `imap-${uid}`,
    correlationId: `imap-${mailbox.id}-${uid}`,
    agentId: 'agent.cv-analyzer',
    payload: {
      cvText: extracted.text,
      fileName,
      criteria,
      threshold: DEFAULT_CV_THRESHOLD,
    },
    context: {
      priority: 'normal',
      requestedBy: 'imap_poller',
      campaignId: campaign.id,
    },
  });
  const analysis = CVAnalysisResultSchema.parse(
    (output.data as { result: unknown }).result,
  );

  // Rapport markdown single-CV — réutilise le renderer batch avec un
  // tableau d'un élément.
  const summary = buildCVBatchSummary([analysis], DEFAULT_CV_THRESHOLD);
  const reportName = `rapport-cv-imap-${slug(analysis.candidateName)}-${uid}.md`;
  const reportContent = renderCVBatchMarkdown(summary, campaign.id);

  const artifactId = `art_imap_cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  try {
    const upload = await uploadArtifact({
      owner: isTaskOwner
        ? { kind: 'task', id: campaign.id }
        : { kind: 'campaign', id: campaign.id },
      name: reportName,
      content: reportContent,
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-poller] storage upload failed', err);
    }
  }

  await insertArtifactMeta({
    id: artifactId,
    campaignId: isTaskOwner ? null : campaign.id,
    taskId: isTaskOwner ? campaign.id : null,
    kind: 'cv_report',
    name: reportName,
    mime: 'text/markdown',
    storageBucket,
    storagePath,
    publicUrl,
    metadata: {
      source: 'imap',
      mailboxId: mailbox.id,
      uid,
      from,
      subject,
      candidate: analysis.candidateName,
      score: analysis.score,
      aboveThreshold: analysis.aboveThreshold,
    },
  });

  await appendJournalEntry({
    action: 'imap_cv_analyzed',
    actor: 'imap_poller',
    campaignId: isTaskOwner ? null : campaign.id,
    payload: {
      mailboxId: mailbox.id,
      uid,
      fileName,
      candidate: analysis.candidateName,
      email: analysis.email,
      score: analysis.score,
      aboveThreshold: analysis.aboveThreshold,
      artifactId,
      publicUrl,
      taskId: isTaskOwner ? campaign.id : undefined,
    },
  });

  // Round 5 fix — déclenche le mail au candidat (refus ou invitation)
  // et, si accepté, le brief DRH avec trame d'entretien. Sans ça,
  // le pipeline IMAP s'arrête à l'analyse sans suite côté humain —
  // bug observé en démo où aucun mail n'arrivait au candidat.
  const jobTitleVal = campaign.fdp.fields.job_title?.value;
  const jobTitle =
    typeof jobTitleVal === 'string' && jobTitleVal.trim().length > 0
      ? jobTitleVal.trim()
      : null;
  try {
    await dispatchImapCandidateOutreach({
      mailboxId: mailbox.id,
      campaignId: campaign.id,
      jobTitle,
      candidate: analysis,
      uid,
    });
  } catch (err) {
    // L'outreach orchestre déjà ses propres journals d'erreur ; ce
    // catch est un filet pour ne pas tuer le poller si quelque
    // chose s'échappe (logique métier vs réseau).
    console.error('[imap-poller] outreach failed', err);
  }
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'candidat'
  );
}

/**
 * Poll TOUTES les mailboxes activées, en parallèle. Appelé par le
 * scheduler. Capture les erreurs par mailbox pour ne pas qu'une
 * mauvaise mailbox tue les autres.
 */
export async function pollAllMailboxes(): Promise<PollOutcome[]> {
  let mailboxes: MailboxRow[];
  try {
    mailboxes = await listEnabledMailboxesWithSecrets();
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
  if (mailboxes.length === 0) return [];
  return Promise.all(
    mailboxes.map((mb) =>
      pollMailbox(mb).catch((err) => ({
        mailboxId: mb.id,
        processed: 0,
        matched: 0,
        errors: 1,
        newLastUid: mb.last_uid_seen,
        _crashed: err instanceof Error ? err.message : String(err),
      })) as Promise<PollOutcome>,
    ),
  );
}
