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

import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
} from '@/lib/agents/cv-report-render';
import { decryptCredential } from '@/lib/crypto/mailbox-credentials';
import {
  dispatchImapCandidateOutreach,
  RetryableOutreachError,
} from '@/lib/imap/outreach';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { persistCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { DEFAULT_HITL_CONFIG } from '@/types/hitl';
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
import { uploadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';
import type { ActiveCampaign } from '@/stores/campaigns-store';

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
      // confirmable). On plafonnera `last_uid_seen` juste en deçà pour que ce
      // message — et tous ceux après lui — soient re-fetchés au prochain poll
      // plutôt que perdus. null = aucun différé.
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
        // On matche d'abord sur les campagnes ACTIVES uniquement. Si
        // rien ne match là, on regarde aussi sur les inactives pour
        // émettre un événement de visibilité (le DRH doit savoir
        // qu'un CV est arrivé mais que la campagne n'écoutait pas).
        const matchedCampaignId = matchCampaignInSubject(
          subject,
          activeAssociatedIds,
        );
        if (!matchedCampaignId) {
          const inactiveMatch = matchCampaignInSubject(subject, associatedIds);
          if (inactiveMatch) {
            const inactiveCamp = campaignsById.get(inactiveMatch);
            await appendJournalEntry({
              action: 'imap_match_inactive_campaign',
              actor: 'imap_poller',
              campaignId: inactiveCamp?.id.startsWith('TASK-')
                ? null
                : inactiveMatch,
              payload: {
                mailboxId: mailbox.id,
                uid,
                subject,
                from: parsed.from?.text ?? null,
                campaignStatus: inactiveCamp?.status ?? 'unknown',
                reason:
                  'campaign_not_active — réactive la campagne ou attends qu\'elle franchisse les jalons',
              },
            }).catch(() => {});
          }
          continue;
        }

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
              // Différé (HITL non confirmable) : ce N'EST PAS un échec. On
              // marque l'UID pour réessai et on ne le compte pas en erreur —
              // l'événement `imap_outreach_deferred` est déjà journalisé en
              // amont. Le candidat reste à traiter au prochain poll.
              if (err instanceof RetryableOutreachError) {
                if (typeof uid === 'number') {
                  minRetryUid =
                    minRetryUid === null ? uid : Math.min(minRetryUid, uid);
                }
                return;
              }
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
    // Fige l'état HITL au moment de l'analyse (audit fidèle). Repli ON.
    hitlConfig: (await getAppSettings())?.hitlConfig ?? DEFAULT_HITL_CONFIG,
  });

  // Alimentation automatique du vivier (§3.1 porte 2). Fire-and-forget : ne
  // bloque pas la suite du poll (outreach), n'échoue jamais vers l'appelant.
  void feedVivierFromApplication({
    application,
    cvText: extracted.text,
    cvContent: buffer,
    cvMimeType: mime,
  });
  // Rapprochement opportuniste (§6.3) — hors campagne (tâche) : no-op.
  void matchVivierApplication(
    isTaskOwner ? null : campaign.id,
    application.candidate.email,
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
    if (err instanceof RetryableOutreachError) throw err;
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
