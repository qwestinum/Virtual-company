/**
 * Poller IMAP — détection automatique de nouveaux CV (Session 5 round 5).
 *
 * Pour chaque mailbox active :
 *   1. Connexion IMAP (imapflow)
 *   2. Récupération des messages avec UID > last_uid_seen
 *   3. Pour chaque message :
 *      - parsing via mailparser
 *      - matching sur le subject (insensible casse) contre les
 *        campaignIds associés à la mailbox ET au statut `active`.
 *        Une campagne associée mais paused/closed/in_progress/draft
 *        n'écoute PAS — un mail qui pointe dessus est journalisé
 *        comme `imap_match_inactive_campaign` puis ignoré.
 *      - extraction des pièces jointes PDF
 *      - pour chaque PJ matchée : insert journal `imap_cv_received`,
 *        analyse via analyzeCVApplication, upload artifact, journal
 *        `imap_cv_analyzed` ou, selon la classe d'erreur (poll-retry.ts) :
 *        `imap_cv_failed` (défaut prouvé du document — le curseur avance),
 *        `imap_cv_retry_scheduled` (échec re-tentable : panne LLM/DB —
 *        curseur GELÉ, backoff durable `imap_cv_retries`), ou
 *        `imap_cv_analysis_abandoned` (plafond de tentatives : binaire
 *        sauvegardé pour traitement manuel, JAMAIS de refus auto)
 *   4. Mise à jour last_uid_seen + last_polled_at + last_error
 *
 * Le poller est appelé par le scheduler toutes les 30s. Une exécution
 * échouée pour une mailbox n'affecte pas les autres (try/catch par
 * mailbox). Les UIDs sont notre seul mécanisme anti-doublon : on ne
 * marque jamais les messages comme \Seen côté serveur pour ne pas
 * modifier l'état de la boîte client.
 */

import { simpleParser } from 'mailparser';

import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import {
  CVExtractError,
  extractCVText,
  guessMimeFromName,
} from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
} from '@/lib/agents/cv-report-render';
import { decryptCredential } from '@/lib/crypto/mailbox-credentials';
import { dispatchImapCandidateOutreach } from '@/lib/imap/outreach';
import {
  classifyProcessingError,
  computeNextRetryAt,
  isInBackoffWindow,
  MAX_CV_ANALYSIS_ATTEMPTS,
  RetryablePollError,
} from '@/lib/imap/poll-retry';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { persistCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import {
  clearCvRetryState,
  listCvRetryStates,
  upsertCvRetryState,
} from '@/lib/db/repos/imap-cv-retries';
import { insertUnmatchedCv } from '@/lib/db/repos/imap-unmatched-cvs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listCampaignsForMailbox,
  listEnabledMailboxesWithSecrets,
  updateMailboxPollState,
  type MailboxRow,
} from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { feedVivierFromApplication } from '@/lib/vivier/ingest-application';
import { matchVivierApplication } from '@/lib/vivier/match-application';
import { openConnection } from '@/lib/imap/client';
import {
  emailBodyText,
  resolveCampaignMatch,
} from '@/lib/imap/campaign-match';
import {
  isSupportedCvAttachment,
  isUnsupportedCvAttachment,
} from '@/lib/imap/cv-attachment';
import {
  uploadArtifact,
  uploadArtifactBinary,
  uploadUnmatchedCvBinary,
} from '@/lib/storage/blob';
import type { ActiveCampaign } from '@/stores/campaigns-store';

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

  // Cache des campagnes pour ne pas re-fetcher à chaque CV. On garde
  // l'ensemble complet pour distinguer plus tard les matches sur
  // campagne inactive (audit dédié) vs les non-matches (silence).
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

  // Round 5 fix — l'écoute IMAP est conditionnée au statut `active`.
  // Une campagne draft / in_progress / paused / closed ne reçoit pas
  // de CV automatique : on ignore les mails qui pointent dessus, et
  // on log un événement dédié pour le futur dashboard (le DRH doit
  // pouvoir voir « tu as reçu un CV pour CAMP-XXX mais la campagne
  // est paused/closed »). Symétrique du filtre snapshotActiveCampaigns
  // utilisé pour l'upload manuel.
  const activeAssociatedIds = associatedIds.filter((id) => {
    const c = campaignsById.get(id);
    return c?.status === 'active';
  });

  // Réessais d'analyse en cours pour cette boîte (correctif audit C2/C3) :
  // compteur + backoff DURABLES — la mémoire de process ne survit ni entre
  // polls ni entre instances serverless. Une requête par poll (lignes rares :
  // uniquement les échecs). Fail-safe : map vide si table absente ⇒ réessai
  // sans plafond, on ne consomme jamais un CV faute de migration.
  const retryStates = await listCvRetryStates(mailbox.id);

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
      // Plus petit UID dont le traitement a été DIFFÉRÉ (état HITL non
      // confirmable, échec d'analyse re-tentable, fenêtre de backoff). On
      // plafonnera `last_uid_seen` juste en deçà pour que ce message — et
      // tous ceux après lui — soient re-fetchés au prochain poll plutôt que
      // perdus. null = aucun différé.
      let minRetryUid: number | null = null;

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
        // Rapprochement campagne : ID `CAMP-XXXX` dans le SUJET (signal fort,
        // nominal) puis, EN REPLI, dans le CORPS (signal faible). Le corps
        // refuse de deviner si plusieurs campagnes distinctes y figurent
        // (`ambiguous`) — un mauvais rattachement silencieux est pire qu'un
        // non-rattachement. Priorité active > inactive (l'inactif = visibilité).
        const body = emailBodyText(parsed);
        const match = resolveCampaignMatch({
          subject,
          body,
          activeIds: activeAssociatedIds,
          associatedIds,
        });

        if (match.kind === 'ambiguous') {
          // Plusieurs campagnes actives citées dans le corps : on NE rattache
          // PAS (on ne devine pas). Trace dédiée pour que le DRH tranche.
          await appendJournalEntry({
            action: 'imap_ambiguous_body_match',
            actor: 'imap_poller',
            campaignId: null,
            payload: {
              mailboxId: mailbox.id,
              uid,
              subject,
              from: parsed.from?.text ?? null,
              campaignIds: match.campaignIds,
              reason:
                'plusieurs campagnes citées dans le corps — préciser l\'identifiant CAMP-XXXX dans le sujet',
            },
          }).catch(() => {});
          continue;
        }

        if (match.kind === 'inactive') {
          const inactiveCamp = campaignsById.get(match.campaignId);
          await appendJournalEntry({
            action: 'imap_match_inactive_campaign',
            actor: 'imap_poller',
            campaignId: inactiveCamp?.id.startsWith('TASK-')
              ? null
              : match.campaignId,
            payload: {
              mailboxId: mailbox.id,
              uid,
              subject,
              from: parsed.from?.text ?? null,
              matchSource: match.source,
              campaignStatus: inactiveCamp?.status ?? 'unknown',
              reason:
                'campaign_not_active — réactive la campagne ou attends qu\'elle franchisse les jalons',
            },
          }).catch(() => {});
          continue;
        }

        if (match.kind === 'none') {
          // C11 (trou `none`) : un mail SANS rattachement mais PORTEUR d'un
          // CV ne s'évapore plus. Binaire stocké (rejouable via
          // POST /api/imap/unmatched/[id]/replay) + trace journal explicite.
          // Un mail sans PJ CV (newsletter, réponse…) reste skippé sans bruit.
          const allNoneAtts = parsed.attachments ?? [];
          const noneCvAtts = allNoneAtts.filter((a) =>
            isSupportedCvAttachment(a.contentType, a.filename),
          );
          const noneUnsupportedAtts = allNoneAtts.filter((a) =>
            isUnsupportedCvAttachment(a.contentType, a.filename),
          );
          if (noneCvAtts.length === 0 && noneUnsupportedAtts.length === 0) {
            continue;
          }
          // Stockage best-effort PAR PJ exploitable (les .doc non extractibles
          // sont tracés mais pas stockés : non rejouables par extractCVText).
          const storedFiles: Array<{
            fileName: string;
            stored: boolean;
            storageError: string | null;
          }> = [];
          for (const att of noneCvAtts) {
            const fileName = att.filename ?? `cv-${uid}.pdf`;
            let storagePath: string | null = null;
            let storageBucket: string | null = null;
            let storageError: string | null = null;
            try {
              const up = await uploadUnmatchedCvBinary({
                mailboxId: mailbox.id,
                uid: String(uid),
                name: fileName,
                content: att.content,
                mimeType: att.contentType || guessMimeFromName(fileName),
              });
              storagePath = up.path;
              storageBucket = up.bucket;
            } catch (upErr) {
              storageError =
                upErr instanceof Error ? upErr.message : String(upErr);
              console.error('[imap-poller] stockage CV non rattaché KO', upErr);
            }
            const inserted = await insertUnmatchedCv({
              mailboxId: mailbox.id,
              uid: String(uid),
              fromAddr: parsed.from?.text ?? null,
              subject,
              fileName,
              mime: att.contentType || guessMimeFromName(fileName),
              storageBucket,
              storagePath,
            });
            storedFiles.push({
              fileName,
              stored: inserted && storagePath !== null,
              storageError,
            });
          }
          // La TRACE journal est l'ÉTAT FINAL qui autorise le curseur à
          // avancer (principe : jamais d'avancée sans état final explicite).
          // Si elle échoue (panne Supabase), on GÈLE le curseur — le mail
          // sera re-présenté au prochain poll.
          try {
            await appendJournalEntry({
              action: 'imap_no_campaign_match',
              actor: 'imap_poller',
              campaignId: null,
              payload: {
                mailboxId: mailbox.id,
                uid: String(uid),
                subject,
                from: parsed.from?.text ?? null,
                storedFiles,
                unsupportedFiles: noneUnsupportedAtts.map(
                  (a) => a.filename ?? null,
                ),
                reason:
                  'CV reçu sans campagne reconnue (aucun identifiant CAMP-XXXX dans le sujet ni le corps) — rejouable via /api/imap/unmatched une fois la campagne choisie',
              },
            });
          } catch (jErr) {
            console.error(
              '[imap-poller] journal imap_no_campaign_match KO — curseur gelé',
              jErr,
            );
            if (typeof uid === 'number') {
              minRetryUid =
                minRetryUid === null ? uid : Math.min(minRetryUid, uid);
              break;
            }
          }
          continue;
        }

        const matchedCampaignId = match.campaignId;
        const matchSource = match.source;

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

        // Extraction des PJ exploitables : PDF + DOCX (extractibles par
        // extractCVText). Détection MIME OU extension — cf. cv-attachment.ts.
        const allAttachments = parsed.attachments ?? [];
        const cvAttachments = allAttachments.filter((a) =>
          isSupportedCvAttachment(a.contentType, a.filename),
        );
        if (cvAttachments.length === 0) {
          // Un CV Word ANCIEN (.doc) est un vrai CV mais non extractible : il
          // ne doit PAS s'évaporer dans 'imap_email_no_cv'. Trace DÉDIÉE et
          // explicite (« renvoyez en PDF ou .docx ») — jamais d'échec
          // silencieux (beaucoup de CV arrivent en Word en recrutement).
          const unsupportedCv = allAttachments.filter((a) =>
            isUnsupportedCvAttachment(a.contentType, a.filename),
          );
          if (unsupportedCv.length > 0) {
            await appendJournalEntry({
              action: 'imap_cv_unsupported_format',
              actor: 'imap_poller',
              campaignId: matchedCampaignId,
              payload: {
                mailboxId: mailbox.id,
                uid,
                subject,
                from: parsed.from?.text ?? null,
                attachments: unsupportedCv.map((a) => ({
                  filename: a.filename ?? null,
                  mime: a.contentType ?? null,
                })),
                reason:
                  'format Word ancien (.doc) non exploitable — demande au candidat un renvoi en PDF ou .docx',
              },
            }).catch(() => {});
            continue;
          }
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
              // quand le DRH envoie un format inattendu et se demande
              // pourquoi « rien ne se passe ». Le retour clair pointe vers
              // « renvoyez en PDF ou .docx ».
              rejectedAttachments: allAttachments.map((a) => ({
                filename: a.filename ?? null,
                mime: a.contentType ?? null,
              })),
            },
          }).catch(() => {});
          continue;
        }

        outcome.matched += 1;

        // Fenêtre de backoff d'un échec re-tentable précédent : on ne
        // re-tente pas encore (zéro coût LLM) et on gèle le curseur ICI —
        // mêmes rails que le différé HITL : ce message et les suivants seront
        // re-fetchés à un prochain poll, après l'échéance.
        const retryState = retryStates.get(String(uid));
        if (
          retryState &&
          isInBackoffWindow(retryState.nextRetryAt, new Date()) &&
          typeof uid === 'number'
        ) {
          minRetryUid = minRetryUid === null ? uid : Math.min(minRetryUid, uid);
          break;
        }

        for (const att of cvAttachments) {
          const fileName = att.filename ?? `cv-${uid}.pdf`;
          await processEmailAttachment({
            mailbox,
            campaign,
            fileName,
            // Repli filename-aware (DOCX sans contentType ⇒ ne pas le forcer en
            // PDF, sinon extractCVText tente pdf-parse et échoue).
            mime: att.contentType || guessMimeFromName(fileName),
            buffer: att.content,
            uid: String(uid),
            subject,
            from: parsed.from?.text ?? null,
            matchSource,
          })
            .then(() => {
              outcome.processed += 1;
              // Analyse aboutie après échec(s) précédent(s) : purge le
              // compteur durable de réessais (best-effort).
              if (retryStates.has(String(uid))) {
                void clearCvRetryState(mailbox.id, String(uid));
              }
            })
            .catch(async (err) => {
              // Différé (HITL non confirmable, échec d'analyse déjà qualifié…) :
              // ce N'EST PAS un échec définitif. On marque l'UID pour réessai
              // et on ne le compte pas en erreur. Le candidat reste à traiter
              // au prochain poll.
              if (err instanceof RetryablePollError) {
                if (typeof uid === 'number') {
                  minRetryUid =
                    minRetryUid === null ? uid : Math.min(minRetryUid, uid);
                }
                return;
              }
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              if (classifyProcessingError(err) === 'permanent') {
                // Défaut PROUVÉ du DOCUMENT (PDF corrompu, texte vide…) :
                // re-tenter le même fichier échouera pareil — pas de réessais,
                // mais le MÊME état final que l'épuisement : binaire sauvegardé
                // + trace « traitement manuel requis ». Deux seuls chemins
                // d'avancée du curseur sur échec, tous deux stockés et tracés.
                // (Classification CONSERVATRICE : en cas de doute sur
                // l'origine, l'erreur est classée transitoire — cf.
                // classifyProcessingError.)
                outcome.errors += 1;
                const failedArtifactId = await persistAbandonedCv({
                  mailbox,
                  campaign,
                  fileName,
                  mime: att.contentType || guessMimeFromName(fileName),
                  buffer: att.content,
                  uid: String(uid),
                });
                await appendJournalEntry({
                  action: 'imap_cv_failed',
                  actor: 'imap_poller',
                  campaignId: matchedCampaignId,
                  payload: {
                    mailboxId: mailbox.id,
                    uid: String(uid),
                    fileName,
                    from: parsed.from?.text ?? null,
                    error: errorMessage,
                    errorClass: 'permanent',
                    artifactId: failedArtifactId,
                    reason:
                      'défaut du fichier (corruption/illisible) — traitement manuel requis, demander un renvoi ; aucun mail envoyé au candidat',
                  },
                }).catch((jErr) =>
                  console.error('[imap-poller] journal imap_cv_failed KO', jErr),
                );
                // Purge un éventuel compteur de réessais antérieur (le même
                // uid a pu échouer en transitoire avant le défaut avéré).
                void clearCvRetryState(mailbox.id, String(uid));
                return;
              }
              // Échec RE-TENTABLE (panne LLM/rate limit/timeout, hoquet DB,
              // verdicts inexploitables) : AUCUNE décision, AUCUN mail —
              // compteur durable + gel du curseur (mêmes rails que le différé
              // HITL). Audit C2/C3 : un incident technique ne consomme plus
              // un CV et ne refuse plus un candidat.
              const attemptsBefore = retryStates.get(String(uid))?.attempts ?? 0;
              const attempts = attemptsBefore + 1;
              const nextRetryAt = computeNextRetryAt(attempts, new Date());
              const persisted = await upsertCvRetryState({
                mailboxId: mailbox.id,
                uid: String(uid),
                attempts,
                nextRetryAt,
                lastError: errorMessage,
              });
              if (persisted && attempts >= MAX_CV_ANALYSIS_ATTEMPTS) {
                // Plafond atteint : ABANDON SIGNALÉ, jamais de refus auto.
                // Le binaire est sauvegardé pour un traitement manuel, la
                // boîte est débloquée (pas de minRetryUid → le curseur peut
                // avancer au-delà de ce message « poison »).
                outcome.errors += 1;
                const abandonArtifactId = await persistAbandonedCv({
                  mailbox,
                  campaign,
                  fileName,
                  mime: att.contentType || guessMimeFromName(fileName),
                  buffer: att.content,
                  uid: String(uid),
                });
                await appendJournalEntry({
                  action: 'imap_cv_analysis_abandoned',
                  actor: 'imap_poller',
                  campaignId: matchedCampaignId,
                  payload: {
                    mailboxId: mailbox.id,
                    uid: String(uid),
                    fileName,
                    from: parsed.from?.text ?? null,
                    attempts,
                    error: errorMessage,
                    artifactId: abandonArtifactId,
                    reason:
                      'analyse impossible après plusieurs tentatives — traitement manuel requis, aucun mail envoyé au candidat',
                  },
                }).catch((jErr) =>
                  console.error(
                    '[imap-poller] journal imap_cv_analysis_abandoned KO',
                    jErr,
                  ),
                );
                void clearCvRetryState(mailbox.id, String(uid));
                return;
              }
              // Réessai programmé : trace explicite + gel du curseur.
              await appendJournalEntry({
                action: 'imap_cv_retry_scheduled',
                actor: 'imap_poller',
                campaignId: matchedCampaignId,
                payload: {
                  mailboxId: mailbox.id,
                  uid: String(uid),
                  fileName,
                  attempt: attempts,
                  nextRetryAt,
                  persisted,
                  error: errorMessage,
                },
              }).catch((jErr) =>
                console.error(
                  '[imap-poller] journal imap_cv_retry_scheduled KO',
                  jErr,
                ),
              );
              if (typeof uid === 'number') {
                minRetryUid =
                  minRetryUid === null ? uid : Math.min(minRetryUid, uid);
              }
            });
        }

        // Un message DIFFÉRÉ arrête le poll ICI. On traite en UID croissant :
        // continuer enverrait des mails à des UID SUPÉRIEURS qui seraient
        // ensuite re-traités (et renvoyés) au prochain poll, puisqu'on va
        // rembobiner `last_uid_seen` sous le message différé. Stopper garantit
        // qu'aucun mail au-delà du différé ne part deux fois. Le différé et la
        // suite sont repris au prochain passage.
        if (minRetryUid !== null) break;
      }

      // Plafonne au plus petit UID différé moins 1 : on committe la
      // progression jusqu'au dernier message RÉELLEMENT traité, mais on
      // re-fetchera le message différé (et la suite) au prochain poll. Anti
      // perte silencieuse : un candidat non traité pour cause de panne n'est
      // jamais marqué « vu ».
      let committedUid = maxUidSeen;
      if (minRetryUid !== null) {
        committedUid = Math.min(committedUid, minRetryUid - 1);
      }
      // N'avance que si on dépasse réellement l'UID déjà committé (sinon on
      // garde `outcome.newLastUid` = last_uid_seen courant, donc pas d'avance).
      if (committedUid > previousLastUid) {
        outcome.newLastUid = String(committedUid);
      }
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

/**
 * Cœur du traitement d'une PJ CV : extraction → analyse → persistance →
 * outreach gaté HITL. Exporté pour le REJEU d'un CV non rattaché (C11,
 * `POST /api/imap/unmatched/[id]/replay`) — le rejeu réutilise EXACTEMENT ce
 * chemin (mêmes gardes fiche validée, mêmes claims d'idempotence par
 * (mailbox, uid) : jamais de double mail), aucun chemin parallèle.
 */
export async function processEmailAttachment(args: {
  mailbox: MailboxRow;
  campaign: ActiveCampaign;
  fileName: string;
  mime: string;
  buffer: Buffer;
  uid: string;
  subject: string;
  from: string | null;
  /**
   * Origine du rattachement campagne : 'subject' (fort) / 'body' (repli) /
   * 'replay' (rejeu humain d'un CV non rattaché, C11).
   */
  matchSource: 'subject' | 'body' | 'replay';
}): Promise<void> {
  const {
    mailbox,
    campaign,
    fileName,
    mime,
    buffer,
    uid,
    subject,
    from,
    matchSource,
  } = args;
  const isTaskOwner = campaign.id.startsWith('TASK-');
  // Comportement (a) — pas de scoring sans fiche de scoring validée.
  const sheet = campaign.scoringSheet?.isValidated
    ? campaign.scoringSheet
    : null;

  // Journal — received (analyse en cours, ou en attente de fiche).
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
      pendingScoringSheet: sheet === null,
      matchSource,
    },
  });

  if (!sheet) {
    // Reçu mais NON analysé : la campagne n'a pas de fiche de scoring validée.
    // Le CV est compté comme reçu, marqué « en attente de fiche » (re-scorable
    // en C7). Pas d'extraction ni d'analyse.
    return;
  }

  // Convertit le Buffer en File pour extractCVText (qui attend File).
  const file = new File([new Uint8Array(buffer)], fileName, { type: mime });
  let extracted;
  try {
    extracted = await extractCVText(file);
  } catch (err) {
    const code = err instanceof CVExtractError ? err.code : 'extract_failed';
    throw new Error(`extract_failed: ${code} — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Pipeline extraction → scoring (code) → narration. Le LLM ne note jamais.
  const { application } = await analyzeCVApplication({
    cvText: extracted.text,
    fileName,
    sheet,
    source: 'email',
    receivedAt: new Date().toISOString(),
    computedAt: new Date().toISOString(),
    // HITL 3 zones — deux poignées de la campagne (repli 0/100 « tout gris »
    // sur les lignes legacy, garanti par rowToCampaign).
    thresholdLow: campaign.thresholdLow,
    thresholdHigh: campaign.thresholdHigh,
  });

  // Statut de résolution email pour le journal (l'email est déjà résolu
  // déterministe dans analyzeCVApplication — cf. resolveCandidateEmail).
  const emailResolution = resolveCandidateEmail(
    extracted.text,
    application.candidate.email,
  );

  // Rapport markdown single-CV — réutilise le renderer batch avec un
  // tableau d'un élément.
  const summary = buildCVBatchSummary(
    [application],
    campaign.thresholdLow,
    campaign.thresholdHigh,
  );
  const reportName = `rapport-cv-imap-${slug(application.candidate.fullName)}-${uid}.md`;
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
      candidate: application.candidate.fullName,
      score: application.scoringResult.totalScore,
      aboveThreshold: application.scoringResult.status === 'accepted',
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
      candidate: application.candidate.fullName,
      email: application.candidate.email,
      emailStatus: emailResolution.status,
      score: application.scoringResult.totalScore,
      aboveThreshold: application.scoringResult.status === 'accepted',
      artifactId,
      publicUrl,
      taskId: isTaskOwner ? campaign.id : undefined,
    },
  });

  // Persiste l'analyse COMPLÈTE pour l'audit candidat (cf.
  // docs/specs/reporting.md §5.3). Id unique par CV reçu = mailbox + uid.
  // Best-effort : avale Supabase non configuré, ne casse pas le poll.
  await persistCandidateAnalysis({
    id: `can_imap_${mailbox.id}_${uid}`,
    // uid brut = clé des marqueurs de parcours du journal (cohérent avec
    // le payload.uid de imap_cv_analyzed → dashboard).
    uid: String(uid),
    campaignId: isTaskOwner ? null : campaign.id,
    application,
  });

  // Alimentation automatique du vivier (§3.1 porte 2). Fire-and-forget : ne
  // bloque pas la suite du poll (outreach), n'échoue jamais vers l'appelant.
  void feedVivierFromApplication({
    application,
    cvText: extracted.text,
    cvContent: buffer,
    cvMimeType: mime,
  });
  // Rapprochement opportuniste (§6.3) — hors campagne (tâche) : no-op. L'id
  // d'analyse permet de figer l'origine vivier (from_vivier) si repêchage.
  void matchVivierApplication(
    isTaskOwner ? null : campaign.id,
    application.candidate.email,
    `can_imap_${mailbox.id}_${uid}`,
  );

  // Round 5 fix — déclenche le mail au candidat (refus ou invitation)
  // et, si accepté, le brief DRH avec trame d'entretien. Sans ça,
  // le pipeline IMAP s'arrête à l'analyse sans suite côté humain —
  // bug observé en démo où aucun mail n'arrivait au candidat.
  const jobTitleVal = campaign.fdp.fields.job_title?.value;
  const jobTitle =
    typeof jobTitleVal === 'string' && jobTitleVal.trim().length > 0
      ? jobTitleVal.trim()
      : null;
  // Persiste le CV (binaire) comme artefact → consultable depuis la carte de
  // validation (parité chat). Best-effort : échec storage → cvArtifactId null.
  let cvArtifactId: string | null = null;
  try {
    const cvUp = await uploadArtifactBinary({
      owner: isTaskOwner
        ? { kind: 'task', id: campaign.id }
        : { kind: 'campaign', id: campaign.id },
      name: fileName,
      content: buffer,
      mimeType: mime,
    });
    const cvId = `art_imap_cvfile_${mailbox.id}_${uid}`;
    await insertArtifactMeta({
      id: cvId,
      campaignId: isTaskOwner ? null : campaign.id,
      taskId: isTaskOwner ? campaign.id : null,
      kind: 'cv',
      name: fileName,
      mime,
      storageBucket: cvUp.bucket,
      storagePath: cvUp.path,
      publicUrl: cvUp.publicUrl,
      metadata: { source: 'imap', mailboxId: mailbox.id, uid },
    });
    cvArtifactId = cvId;
  } catch (cvErr) {
    if (!(cvErr instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-poller] persistance CV échouée', cvErr);
    }
  }

  try {
    await dispatchImapCandidateOutreach({
      mailboxId: mailbox.id,
      campaignId: campaign.id,
      jobTitle,
      // Frontière vers le sous-système mail/scheduler non encore migré (6c-mail) :
      // on projette vers l'ancienne forme via l'adapter transitoire.
      candidate: cvApplicationToMailCandidate(application),
      uid,
      // Rapport d'analyse déjà généré + persisté ci-dessus : on le relie à la
      // validation (parité chat — sinon la carte n'affiche pas « 📄 Rapport »).
      reportArtifactId: artifactId,
      cvArtifactId,
    });
  } catch (err) {
    // Différé HITL : on REMONTE pour que la boucle ne marque pas le message
    // comme vu (réessai au prochain poll). Tout le reste est avalé : l'outreach
    // orchestre déjà ses propres journals d'erreur, on ne tue pas le poller
    // pour une erreur métier/réseau ponctuelle.
    if (err instanceof RetryablePollError) throw err;
    console.error('[imap-poller] outreach failed', err);
  }
}

/**
 * Sauvegarde le binaire d'un CV en ÉCHEC FINAL — plafond de réessais atteint
 * OU défaut permanent prouvé du fichier : dans les deux cas, le fichier doit
 * rester récupérable pour un traitement manuel — un échec signalé n'est
 * jamais un CV évaporé (audit C2/C3). Id dédié (`cvabandon`) pour ne pas
 * entrer en collision avec l'artefact `cv` nominal si une passe précédente
 * était allée plus loin. Best-effort : `null` si le storage échoue (le
 * journal reste la trace).
 */
async function persistAbandonedCv(args: {
  mailbox: MailboxRow;
  campaign: ActiveCampaign;
  fileName: string;
  mime: string;
  buffer: Buffer;
  uid: string;
}): Promise<string | null> {
  const isTaskOwner = args.campaign.id.startsWith('TASK-');
  try {
    const up = await uploadArtifactBinary({
      owner: isTaskOwner
        ? { kind: 'task', id: args.campaign.id }
        : { kind: 'campaign', id: args.campaign.id },
      name: args.fileName,
      content: args.buffer,
      mimeType: args.mime,
    });
    const id = `art_imap_cvabandon_${args.mailbox.id}_${args.uid}`;
    await insertArtifactMeta({
      id,
      campaignId: isTaskOwner ? null : args.campaign.id,
      taskId: isTaskOwner ? args.campaign.id : null,
      kind: 'cv',
      name: args.fileName,
      mime: args.mime,
      storageBucket: up.bucket,
      storagePath: up.path,
      publicUrl: up.publicUrl,
      metadata: {
        source: 'imap',
        mailboxId: args.mailbox.id,
        uid: args.uid,
        abandonedAnalysis: true,
      },
    });
    return id;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[imap-poller] sauvegarde CV abandonné échouée', err);
    }
    return null;
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
 * Garde anti-réentrance : un seul poll à la fois DANS CE PROCESS. `last_uid_seen`
 * n'est écrit qu'en FIN de `pollMailbox` ; si un second poll démarre pendant
 * qu'un premier analyse encore un CV (LLM > intervalle de 30 s, ou /poll-now
 * concurrent), les deux lisent le MÊME `last_uid_seen`, re-traitent le même
 * message et envoient le mail en double. Le flag vit sur `globalThis` pour
 * survivre aux hot-reloads dev (même raison que le handle du scheduler).
 *
 * Limite : sur Vercel chaque invocation cron est un process isolé ⇒ ce flag ne
 * les sérialise pas. Le cron étant à la minute et mono-instance en pratique, le
 * risque y est marginal ; une idempotence durable (clé `uid`) reste la vraie
 * parade serverless si besoin (cf. note de revue).
 */
declare global {
  // eslint-disable-next-line no-var
  var __imapPollInFlight__: boolean | undefined;
}

/**
 * Poll TOUTES les mailboxes activées, en parallèle. Appelé par le
 * scheduler. Capture les erreurs par mailbox pour ne pas qu'une
 * mauvaise mailbox tue les autres.
 */
export async function pollAllMailboxes(): Promise<PollOutcome[]> {
  // Un poll déjà en cours ⇒ on saute ce déclenchement (anti double-traitement).
  if (globalThis.__imapPollInFlight__) return [];
  globalThis.__imapPollInFlight__ = true;
  try {
    let mailboxes: MailboxRow[];
    try {
      mailboxes = await listEnabledMailboxesWithSecrets();
    } catch (err) {
      if (err instanceof SupabaseNotConfiguredError) return [];
      throw err;
    }
    if (mailboxes.length === 0) return [];
    // `await` IMPÉRATIF ici : le `finally` ne doit libérer le flag qu'une fois
    // TOUTES les mailboxes relevées (sinon il retombe à false immédiatement et
    // la garde ne sert à rien).
    return await Promise.all(
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
  } finally {
    globalThis.__imapPollInFlight__ = false;
  }
}
