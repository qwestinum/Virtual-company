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
 *        le curseur AVANCE, l'uid attend dans `imap_cv_retries` et est
 *        re-fetché nommément à son échéance), ou
 *        `imap_cv_analysis_abandoned` (plafond de tentatives : binaire
 *        sauvegardé pour traitement manuel, JAMAIS de refus auto)
 *   4. Mise à jour last_uid_seen + last_polled_at + last_error
 *
 * Deux phases par poll (incident 24/07/2026) : COLLECTE brève (connexion
 * IMAP tenue le temps de rapatrier uid+source en mémoire) puis TRAITEMENT
 * hors connexion — les analyses LLM durent des minutes, un socket IMAP
 * gardé ouvert mourait et le crash (avalé) sautait le commit du curseur ⇒
 * re-analyses en boucle des mêmes CV à chaque cycle.
 *
 * Le poller est appelé par le scheduler toutes les 30s. Une exécution
 * échouée pour une mailbox n'affecte pas les autres (try/catch par
 * mailbox). Les UIDs sont notre seul mécanisme anti-doublon : on ne
 * marque jamais les messages comme \Seen côté serveur pour ne pas
 * modifier l'état de la boîte client.
 */

import { simpleParser } from 'mailparser';

import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import { extractCVText, guessMimeFromName } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
} from '@/lib/agents/cv-report-render';
import { decryptCredential } from '@/lib/crypto/mailbox-credentials';
import { imapAnalysisId } from '@/lib/imap/analysis-id';
import { dispatchImapCandidateOutreach } from '@/lib/imap/outreach';
import {
  buildFetchSet,
  classifyProcessingError,
  computeNextRetryAt,
  initialCursorFor,
  isInBackoffWindow,
  MAX_CV_ANALYSIS_ATTEMPTS,
  nextCommitTarget,
  OperationTimeoutError,
  RetryablePollError,
  shouldProcessUid,
  withTimeout,
} from '@/lib/imap/poll-retry';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { mailboxFolder } from '@/lib/db/repos/mailboxes';
import {
  insertArtifactMeta,
  upsertArtifactMeta,
} from '@/lib/db/repos/artifacts';
import { persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
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
import type { ImapFlow } from 'imapflow';

import { openConnection } from '@/lib/imap/client';
import {
  emailBodyText,
  resolveCampaignMatch,
} from '@/lib/imap/campaign-match';
import {
  isSupportedCvAttachment,
  isUnsupportedCvAttachment,
  orderCvAttachmentsByPriority,
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
/**
 * Budget TOTAL d'ouverture d'une boîte (connexion + SELECT), partagé entre les
 * deux étapes.
 *
 * Certains comptes répondent LENTEMENT, indépendamment de ce qu'on leur
 * demande. Mesuré le 20/08/2026 : un compte à ~31 s de connexion et ~10 s par
 * commande — y compris pour ouvrir un dossier VIDE — quand un autre répond en
 * 0,2 s. La lenteur est propre au compte (limitation du fournisseur, souvent
 * déclenchée par un usage intensif), pas à la taille de la boîte.
 *
 * Sans borne, une telle boîte épuisait les 60 s de `maxDuration` AVANT de lire
 * le moindre message, et l'invocation était tuée avant toute écriture d'état :
 * ni `last_polled_at`, ni `last_error`, ni journal — un silence indiscernable
 * d'une boîte jamais sélectionnée.
 *
 * 20 s : très large pour une boîte saine, et il reste de quoi lire et traiter
 * dans l'invocation. Au-delà, on ABANDONNE en le DISANT.
 */
const MAILBOX_OPEN_BUDGET_MS = 20_000;

/** Raisons pour lesquelles une boîte ACTIVÉE n'a pas été relevée. */
type MailboxSkipReason =
  | 'already_in_flight'
  | 'no_campaign_associated'
  | 'open_timeout'
  | 'select_failed';

/**
 * Trace un saut de boîte — UNE FOIS PAR TRANSITION, jamais à chaque relève.
 *
 * Sauter une boîte `is_enabled` sans rien écrire est un défaut
 * d'observabilité à part entière : un opérateur ne peut pas diagnostiquer un
 * « rien ». Le 20/08/2026, il a fallu trois requêtes et une hypothèse pour
 * découvrir ce qu'une ligne de journal aurait dit.
 *
 * Mais une trace qui se répète à l'identique cesse d'informer et devient une
 * nuisance : réécrite à chaque poll sur une boîte durablement en échec, elle
 * produit 1 440 lignes par jour. Le 21/08/2026, elle occupait 475 des 500
 * lignes de la fenêtre du fil d'activité du Bureau et en avait EXPULSÉ tous
 * les évènements métier. L'état courant, lui, vit déjà dans `last_error` et
 * `last_skip_reason` — le journal n'a à porter que le CHANGEMENT.
 *
 * On journalise donc à la première occurrence et à chaque changement de cause ;
 * `last_skip_reason` est remis à `null` par un poll abouti, pour qu'une
 * rechute soit re-signalée. La mémoire est en BASE et non en process : sur des
 * invocations isolées (serverless), un marqueur en mémoire ne verrait qu'une
 * fraction des polls et laisserait passer le bruit.
 */
async function traceMailboxSkipped(
  mailbox: MailboxRow,
  reason: MailboxSkipReason,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (mailbox.last_skip_reason === reason) return;
  await appendJournalEntry({
    action: 'imap_mailbox_skipped',
    actor: 'imap_poller',
    payload: {
      mailboxId: mailbox.id,
      label: mailbox.label,
      reason,
      // Ce que le lecteur perd en fréquence, il le gagne en clarté : la trace
      // DIT qu'elle vaut jusqu'au prochain changement.
      repeatedUntilChange: true,
      previousReason: mailbox.last_skip_reason,
      ...extra,
    },
  }).catch(() => {
    // Le journal est un confort de diagnostic : son échec ne doit jamais
    // faire échouer une relève.
  });
  // Mémorisé APRÈS la trace : si l'écriture d'état échoue, on re-journalisera
  // au prochain poll — un doublon vaut mieux qu'un saut jamais signalé.
  await updateMailboxPollState(mailbox.id, { lastSkipReason: reason }).catch(
    () => {},
  );
}

/**
 * Budget de fermeture d'une connexion IMAP.
 *
 * `client.logout()` ne rend PAS la main après un `break` sur un fetch large :
 * le serveur streame encore, et `socketTimeout` ne couvre pas ce cas puisque
 * le socket reçoit des données. Mesuré le 20/08/2026 sur une boîte de 25 685
 * messages : toujours bloqué à 240 s. Comme toutes les écritures d'état du
 * poll sont APRÈS ce point, la boîte devenait totalement muette.
 */
const LOGOUT_TIMEOUT_MS = 10_000;

/** Budget du SEARCH d'amorçage — au-delà, `uidNext` suffit. */
const INITIAL_SEARCH_TIMEOUT_MS = 15_000;

/**
 * Ferme la connexion en un temps BORNÉ. Le `logout` poli d'abord (il laisse le
 * serveur libérer proprement), la coupure sèche ensuite. Ne lève jamais : les
 * messages sont déjà en mémoire, la phase 2 doit se dérouler quoi qu'il arrive.
 */
async function closeConnection(client: ImapFlow): Promise<void> {
  try {
    await withTimeout(client.logout(), LOGOUT_TIMEOUT_MS, 'imap_logout');
  } catch {
    try {
      client.close();
    } catch {
      // Déjà fermée — rien à faire.
    }
  }
}

/**
 * Curseur de départ d'une boîte jamais relevée. L'INBOX doit être ouverte.
 *
 * On cherche d'abord les messages arrivés DEPUIS le branchement de la boîte :
 * c'est le cas nominal d'une recette (on branche, on s'envoie un CV), et ce
 * CV-là ne doit pas être perdu. À défaut — SEARCH indisponible, trop lent, ou
 * aucun message depuis — on se place juste avant `uidNext` : tout ce qui
 * arrivera ensuite sera vu. Jamais l'uid 1.
 */
async function resolveInitialCursor(
  client: ImapFlow,
  mailbox: MailboxRow,
): Promise<number | null> {
  const status = client.mailbox;
  const uidNext =
    typeof status === 'object' && status && typeof status.uidNext === 'number'
      ? status.uidNext
      : null;

  let uidsSinceConnection: number[] = [];
  const since = new Date(mailbox.created_at);
  if (Number.isFinite(since.getTime())) {
    try {
      const found = await withTimeout(
        Promise.resolve(client.search({ since }, { uid: true })),
        INITIAL_SEARCH_TIMEOUT_MS,
        'imap_search_since',
      );
      if (Array.isArray(found)) uidsSinceConnection = found;
    } catch {
      // Repli sur `uidNext` : un cran plus strict (le courrier du jour n'est
      // pas repris), jamais un retour à l'uid 1.
    }
  }

  return initialCursorFor({ uidNext, uidsSinceConnection });
}

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
    await traceMailboxSkipped(mailbox, 'already_in_flight');
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
    // Boîte activée mais rattachée à AUCUNE campagne : on note le poll (preuve
    // qu'on a fait le travail, pas d'erreur) — et on le DIT. Sans cette trace,
    // l'écran affiche « relevée, aucune erreur » alors que rien n'a été fait,
    // ce qui est le pire des deux mondes.
    await updateMailboxPollState(mailbox.id, { lastError: null });
    await traceMailboxSkipped(mailbox, 'no_campaign_associated');
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

  // OUVERTURE BORNÉE (connexion + SELECT). Le budget est partagé entre les
  // deux étapes : ce qui compte est le temps total avant de pouvoir lire, et
  // c'est LUI qui doit tenir dans l'invocation.
  const openDeadline = Date.now() + MAILBOX_OPEN_BUDGET_MS;
  const openBudgetLeft = () => Math.max(1, openDeadline - Date.now());
  const folder = mailboxFolder(mailbox);

  let client;
  try {
    client = await withTimeout(
      openConnection({
        host: mailbox.imap_host,
        port: mailbox.imap_port,
        secure: mailbox.imap_ssl,
        user: mailbox.user_email,
        password,
      }),
      openBudgetLeft(),
      'imap_connect',
    );
  } catch (err) {
    const timedOut = err instanceof OperationTimeoutError;
    const msg = err instanceof Error ? err.message || err.name : String(err);
    await updateMailboxPollState(mailbox.id, {
      lastError: `${timedOut ? 'open_timeout' : 'connect_failed'}: ${msg}`,
    });
    if (timedOut) await traceMailboxSkipped(mailbox, 'open_timeout', { folder });
    outcome.errors += 1;
    return outcome;
  }

  // DÉCOUPLAGE curseur / retry (incident 07/2026) : le set fetché = les
  // retries ÉCHUS re-fetchés NOMMÉMENT (ils sont derrière le curseur)
  // + la plage des nouveaux messages. Un uid en fenêtre de backoff n'est
  // PAS fetché : il attend dans `imap_cv_retries` sans geler la file.
  //
  // `let` et non `const` : une boîte JAMAIS relevée n'a pas encore de curseur,
  // et celui-ci ne peut être établi qu'une fois l'INBOX ouverte — il dépend
  // d'`uidNext` et des messages reçus depuis le branchement. Le set fetché est
  // donc construit PLUS BAS, dans la phase 1.
  let previousLastUid = mailbox.last_uid_seen
    ? Number(mailbox.last_uid_seen)
    : 0;
  let hasCursor = mailbox.last_uid_seen !== null;
  const dueRetryUids = new Set<number>();
  let maxUidSeen = previousLastUid;
  /** Curseur initial à PERSISTER (boîte neuve) — écrit hors connexion IMAP. */
  let pendingBaseline: number | null = null;
  // Plus petit UID dont l'ÉTAT FINAL n'a pas pu être écrit (ex. journal
  // `imap_no_campaign_match` KO — panne DB) : avancer le consommerait
  // sans trace. C'est le frein « DB down », PLUS JAMAIS le frein « CV en
  // retry » (les retries vivent dans leur table, la file continue).
  let minRetryUid: number | null = null;

  // Garde-fou : si la mailbox est neuve (last_uid_seen null) et contient déjà
  // 10 000 messages anciens, on ne veut pas tous les analyser. On limite à 50
  // messages par poll ; les polls suivants remontent incrémentalement.
  const HARD_LIMIT_PER_POLL = 50;

  // Phase 1 — COLLECTE, connexion tenue BRIÈVEMENT : on rapatrie uid + source
  // en mémoire (borné à HARD_LIMIT_PER_POLL) puis on FERME la connexion AVANT
  // tout traitement. Cause de l'incident 24/07/2026 : les analyses LLM durent
  // plusieurs minutes, le socket IMAP mourait pendant (Gmail coupe), la fin du
  // poll levait (itérateur/release), l'exception — avalée en `_crashed` —
  // sautait le commit du curseur ⇒ les MÊMES CV étaient re-analysés à chaque
  // cycle de 30 s, indéfiniment.
  const fetchedMessages: Array<{ uid?: number; source?: Buffer }> = [];
  try {
    // Dossier configurable (défaut INBOX) et ouverture BORNÉE : sur un compte
    // lent, le SELECT seul peut consommer tout le budget de l'invocation, et
    // il est rejoué à chaque passage puisque le serverless ne garde aucune
    // connexion ouverte entre deux relèves.
    let lock;
    try {
      lock = await withTimeout(
        client.getMailboxLock(folder),
        openBudgetLeft(),
        'imap_select',
      );
    } catch (err) {
      const timedOut = err instanceof OperationTimeoutError;
      const msg = err instanceof Error ? err.message || err.name : String(err);
      await updateMailboxPollState(mailbox.id, {
        lastError: `${timedOut ? 'open_timeout' : 'select_failed'}: ${folder}: ${msg}`,
      });
      await traceMailboxSkipped(
        mailbox,
        timedOut ? 'open_timeout' : 'select_failed',
        { folder, detail: msg },
      );
      outcome.errors += 1;
      await closeConnection(client);
      return outcome;
    }
    try {
      // Boîte JAMAIS relevée : on se place au bord RÉCENT. Repartir de l'uid 1
      // sur une messagerie personnelle déjà pleine ne remonte jamais jusqu'au
      // courrier du jour (cf. `initialCursorFor`, incident 20/08/2026).
      if (!hasCursor) {
        const baseline = await resolveInitialCursor(client, mailbox);
        if (baseline !== null) {
          previousLastUid = baseline;
          maxUidSeen = baseline;
          hasCursor = true;
          pendingBaseline = baseline;
        }
      }

      for (const [uidStr, st] of retryStates) {
        const n = Number(uidStr);
        if (
          Number.isFinite(n) &&
          n <= previousLastUid &&
          !isInBackoffWindow(st.nextRetryAt, new Date())
        ) {
          dueRetryUids.add(n);
        }
      }
      const fromUid = buildFetchSet(
        hasCursor ? previousLastUid : null,
        [...dueRetryUids],
      );

      for await (const message of client.fetch(
        fromUid,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (fetchedMessages.length >= HARD_LIMIT_PER_POLL) break;
        fetchedMessages.push({ uid: message.uid, source: message.source });
      }
    } finally {
      try {
        lock.release();
      } catch {
        // Socket déjà mort — les messages sont en mémoire, on continue.
      }
    }
  } finally {
    await closeConnection(client);
  }

  // Curseur initial : écrit HORS connexion IMAP (une latence DB n'a rien à
  // faire sous le verrou INBOX) et AVANT tout traitement — pour qu'une boîte
  // neuve cesse immédiatement d'être un « last_uid_seen NULL » opaque, même si
  // la relève échoue ensuite. Poser le curseur ne saute rien : les messages à
  // traiter sont tous AU-DESSUS.
  if (pendingBaseline !== null) {
    try {
      await updateMailboxPollState(mailbox.id, {
        lastUidSeen: String(pendingBaseline),
      });
    } catch (err) {
      console.error(
        `[imap-poller] curseur initial ${pendingBaseline} non persisté pour ${mailbox.id}`,
        err,
      );
    }
    await appendJournalEntry({
      action: 'imap_mailbox_baseline_set',
      actor: 'imap_poller',
      payload: {
        mailboxId: mailbox.id,
        baselineUid: pendingBaseline,
        reason:
          'boîte branchée sur une messagerie existante — la relève démarre au courrier récent, les messages antérieurs ne sont pas analysés',
      },
    }).catch(() => {});
  }

  // Phase 2 — TRAITEMENT, hors connexion. Filet de sécurité : un crash
  // inattendu ne saute plus le commit — la progression jusqu'au message
  // PRÉCÉDENT est committée (le message en cours sera re-présenté), l'erreur
  // est loggée ET écrite dans `last_error` (plus jamais un crash silencieux
  // qui fige la boîte).
  let crashError: string | null = null;
  let currentUid: number | null = null;

  // COMMIT PAR MESSAGE (durcissement Vercel) : `maxDuration` tue la fonction
  // cron NET, sans laisser le moindre code s'exécuter — un commit unique en
  // fin de relève serait perdu et un lot de plusieurs CV (> 60 s d'analyses)
  // re-partirait de zéro à chaque cron, indéfiniment. On committe donc dès
  // qu'un message est résolu : même tuée, l'invocation a définitivement
  // acquis ce qu'elle a traité, la suivante reprend APRÈS. Un échec d'écriture
  // n'est pas fatal (re-tenté au message suivant et en fin de poll).
  let committedSoFar = previousLastUid;
  const commitProgress = async (): Promise<void> => {
    const target = nextCommitTarget(maxUidSeen, minRetryUid, committedSoFar);
    if (target === null) return;
    try {
      await updateMailboxPollState(mailbox.id, { lastUidSeen: String(target) });
      committedSoFar = target;
      outcome.newLastUid = String(target);
    } catch (err) {
      console.error(
        `[imap-poller] commit curseur ${target} KO pour ${mailbox.id} (re-tenté au message suivant)`,
        err,
      );
    }
  };

  try {
    for (const message of fetchedMessages) {
      const uid = message.uid;
      if (typeof uid === 'number') currentUid = uid;
      // Arriver ici = tous les messages PRÉCÉDENTS ont un état final : on
      // committe AVANT d'entamer celui-ci (maxUidSeen ne l'inclut pas encore).
      await commitProgress();
      // Garde-fou anti-retraitement (Round 5 fix) : Gmail renvoie le
      // dernier message même si le range start dépasse uidNext
      // (sémantique IMAP du `*` quand la borne basse dépasse le
      // max). Un uid ≤ curseur n'est traité QUE s'il est un retry échu
      // re-fetché nommément (`dueRetryUids`) — et un retry ancien ne fait
      // JAMAIS reculer ni stagner le curseur (`maxUidSeen` ne bouge que sur
      // les uids nouveaux).
      if (typeof uid === 'number') {
        if (!shouldProcessUid(uid, previousLastUid, dueRetryUids)) continue;
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

      // Fenêtre de backoff d'un échec re-tentable précédent : normalement
      // pas fetché (exclu du set) — s'il se présente quand même (curseur
      // non commité au poll précédent, re-fetch parasite), on SKIPPE sans
      // coût LLM. La ligne `imap_cv_retries` porte l'échéance, la file
      // CONTINUE — plus aucun gel de curseur ici.
      const retryState = retryStates.get(String(uid));
      if (retryState && isInBackoffWindow(retryState.nextRetryAt, new Date())) {
        continue;
      }

      // « Un mail = une candidature » (incident Malaka 30/07/2026) : les PJ
      // sont analysées par vraisemblance CV décroissante et la PREMIÈRE
      // reconnue comme un vrai CV porte LA candidature du mail — les
      // suivantes ne sont plus analysées (tracées). Une PJ classée non-CV
      // (lettre APEC, export profil) est skippée tracée tant qu'il reste des
      // candidates ; la DERNIÈRE est traitée sans skip (dernier recours : la
      // voie « Candidat anonyme » historique — un mail sans aucun vrai CV
      // reste une candidature visible, jamais une perte muette).
      const orderedAttachments = orderCvAttachmentsByPriority(
        cvAttachments,
        (a) => a.filename,
      );
      for (let attIdx = 0; attIdx < orderedAttachments.length; attIdx++) {
        const att = orderedAttachments[attIdx];
        const fileName = att.filename ?? `cv-${uid}.pdf`;
        try {
          const attachmentOutcome = await processEmailAttachment({
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
            retryAttempt: retryStates.get(String(uid))?.attempts ?? 0,
            skipIfNotCv: attIdx < orderedAttachments.length - 1,
          });
          if (attachmentOutcome === 'not_a_cv') {
            // PJ annexe écartée (tracée par processEmailAttachment) — la
            // PJ suivante tente de porter la candidature.
            continue;
          }
          if (attachmentOutcome === 'pending_sheet') {
            // Fiche non validée : TOUTES les PJ doivent rejoindre la file C4
            // pour que le drain puisse ensuite choisir le vrai CV.
            continue;
          }
          // 'processed' : LA candidature du mail est produite.
          outcome.processed += 1;
          // Analyse aboutie après échec(s) précédent(s) : purge le
          // compteur durable de réessais (best-effort).
          if (retryStates.has(String(uid))) {
            void clearCvRetryState(mailbox.id, String(uid));
          }
          const notAnalyzed = orderedAttachments.slice(attIdx + 1);
          if (notAnalyzed.length > 0) {
            // Jamais un skip muet : les PJ jamais analysées sont tracées.
            await appendJournalEntry({
              action: 'imap_attachments_not_analyzed',
              actor: 'imap_poller',
              campaignId: matchedCampaignId,
              payload: {
                mailboxId: mailbox.id,
                uid: String(uid),
                analyzedFileName: fileName,
                fileNames: notAnalyzed.map((rest) => rest.filename ?? null),
                reason:
                  'un mail = une candidature — candidature déjà portée par la PJ analysée',
              },
            }).catch(() => {});
          }
          break;
        } catch (err) {
          // Différé HITL (`RetryablePollError`) et échecs re-tentables
          // empruntent le MÊME rail : ligne `imap_cv_retries` + échéance,
          // la file continue (plus de gel de curseur). Le différé compte
          // dans le plafond (validé DRH) : non résolu en ~21 min ⇒
          // abandon signalé, jamais une attente invisible.
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          if (classifyProcessingError(err) === 'permanent') {
            // Défaut PROUVÉ du DOCUMENT (PDF corrompu, texte vide…) :
            // re-tenter le même fichier échouera pareil — pas de réessais,
            // mais le MÊME état final que l'épuisement : binaire sauvegardé
            // + trace « traitement manuel requis ». La sélection CONTINUE
            // sur la PJ suivante (un mail dont la lettre est corrompue peut
            // porter un vrai CV sain). (Classification CONSERVATRICE : en
            // cas de doute sur l'origine, l'erreur est classée transitoire
            // — cf. classifyProcessingError.)
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
            continue;
          }
          // Échec RE-TENTABLE (panne LLM/rate limit/timeout, hoquet DB,
          // verdicts inexploitables) : AUCUNE décision, AUCUN mail —
          // compteur durable + échéance (mêmes rails que le différé
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
          if (!persisted || attempts >= MAX_CV_ANALYSIS_ATTEMPTS) {
            // Plafond atteint OU réessai non mémorisable (fail-safe
            // INVERSÉ : impossible de mémoriser ⇒ on ne réessaie pas —
            // l'ancien « réessai sans plafond » gelait la file sans fin
            // quand la table manquait) : ABANDON SIGNALÉ, jamais de refus
            // auto. Binaire sauvegardé pour traitement manuel, et la
            // sélection CONTINUE sur la PJ suivante — un mail dont une PJ
            // est « poison » peut encore porter sa candidature via le
            // vrai CV.
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
            continue;
          }
          // Réessai programmé : trace explicite, la FILE CONTINUE (le
          // curseur avance — l'uid attend son échéance dans
          // `imap_cv_retries` et sera re-fetché nommément ; le message
          // ENTIER sera re-présenté, la sélection re-déroulera le même
          // ordre déterministe — on STOPPE donc les PJ restantes de ce
          // passage, inutile d'insister pendant la panne).
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
          break;
        }
      }

      // Frein « DB down » uniquement : un ÉTAT FINAL inécrivable (journal
      // KO) arrête le poll — continuer consommerait des mails sans trace,
      // et la panne frappera pareil les suivants. Les retries d'analyse ne
      // passent PLUS par ici (découplage — la file ne s'arrête jamais
      // derrière un CV en retry ; le re-traitement est couvert par les
      // claims deux-phases, aucun mail ne part deux fois).
      if (minRetryUid !== null) break;
    }
  } catch (err) {
    // Crash inattendu du traitement (le corps protège déjà ses chemins
    // connus) : on committe la progression jusqu'au message PRÉCÉDENT — le
    // message en cours n'a pas d'état final, il sera re-présenté au prochain
    // poll. Bruyant, jamais silencieux.
    crashError = `poll_processing_crashed: ${
      err instanceof Error ? err.message || err.name : String(err)
    }`;
    console.error(
      '[imap-poller] crash de traitement — progression committée jusqu’au message précédent',
      err,
    );
    if (typeof currentUid === 'number') {
      maxUidSeen = Math.min(
        maxUidSeen,
        Math.max(previousLastUid, currentUid - 1),
      );
    }
    outcome.errors += 1;
  }

  // Commit FINAL : couvre le dernier message résolu (le commit par message
  // n'écrit qu'en début d'itération SUIVANTE). Même clamps : frein « DB
  // down » (`minRetryUid` − 1), jamais de recul (`committedSoFar`) — après
  // un crash, `maxUidSeen` a été ramené au message précédent (filet
  // ci-dessus), le message interrompu sera re-présenté.
  await commitProgress();

  await updateMailboxPollState(mailbox.id, { lastError: crashError });

  // Ce poll est allé au bout : la boîte n'est plus sautée. On efface la cause
  // mémorisée pour qu'une rechute soit re-journalisée au lieu d'être confondue
  // avec l'épisode précédent.
  //
  // Écriture SÉPARÉE et conditionnelle, à dessein : (1) rien à effacer dans le
  // cas nominal, donc aucun aller-retour de plus par relève ; (2) tant que la
  // colonne `last_skip_reason` n'est pas migrée, l'échec reste confiné à ce
  // confort de diagnostic au lieu d'emporter l'écriture d'état du poll — le
  // code peut donc être déployé avant la migration sans casser la relève.
  if (mailbox.last_skip_reason) {
    await updateMailboxPollState(mailbox.id, { lastSkipReason: null }).catch(
      () => {},
    );
  }
  return outcome;
}

/**
 * Issue du traitement d'UNE PJ — pilote la sélection « un mail = une
 * candidature » côté appelant :
 *  - `processed`    : la PJ a produit LA candidature du mail (analyse persistée,
 *                     outreach gaté HITL enclenché) — ne plus traiter les autres PJ.
 *  - `not_a_cv`     : PJ classée non-CV (lettre, doc annexe) et `skipIfNotCv`
 *                     actif → RIEN n'a été persisté, l'appelant essaie la PJ suivante.
 *  - `pending_sheet`: fiche de scoring non validée → binaire stocké en file
 *                     C4 (l'appelant continue : TOUTES les PJ doivent être
 *                     stockées pour que le drain puisse choisir le vrai CV).
 */
export type ProcessAttachmentOutcome = 'processed' | 'not_a_cv' | 'pending_sheet';

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
  /**
   * Nombre de tentatives DÉJÀ échouées pour cet uid (rail `imap_cv_retries`).
   * Tracé en `attempt` dans `imap_cv_received` — une entrée par tentative est
   * une trace HONNÊTE du re-traitement, pas un doublon à supprimer.
   */
  retryAttempt?: number;
  /**
   * Sélection « un mail = une candidature » : si l'analyse classe la PJ
   * non-CV (`isCv: false`), NE PAS persister l'anonyme — rendre `not_a_cv`
   * pour que l'appelant essaie la PJ suivante du mail. `false` (défaut) =
   * dernier recours / rejeu humain : la voie « Candidat anonyme » s'applique.
   */
  skipIfNotCv?: boolean;
}): Promise<ProcessAttachmentOutcome> {
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
    retryAttempt = 0,
    skipIfNotCv = false,
  } = args;
  const isTaskOwner = campaign.id.startsWith('TASK-');
  // Comportement (a) — pas de scoring sans fiche de scoring validée.
  const sheet = campaign.scoringSheet?.isValidated
    ? campaign.scoringSheet
    : null;

  if (!sheet) {
    // C4 : reçu AVANT la validation de la fiche de scoring → le binaire est
    // STOCKÉ + mis en file `pending_sheet` (infrastructure C11), drainée
    // AUTOMATIQUEMENT à la validation de la fiche (`drainPendingSheetCvs`).
    // Avant : return sec après le journal, binaire jamais stocké, UID avancé —
    // toute la première vague d'une campagne à fiche tardive était perdue.
    // Un échec de stockage/insert LÈVE : classé re-tentable par les rails
    // (curseur gelé + backoff) — on ne consomme jamais un CV sans état final
    // rejouable. NB : ce branchement est inatteignable en `matchSource:
    // 'replay'` (le rejeu exige une fiche validée côté route/drain), sinon
    // l'upsert `(mailbox, uid, file_name)` no-operait sur la ligne déjà
    // consommée.
    const up = await uploadUnmatchedCvBinary({
      mailboxId: mailbox.id,
      uid: String(uid),
      name: fileName,
      content: buffer,
      mimeType: mime || guessMimeFromName(fileName),
    });
    const inserted = await insertUnmatchedCv({
      mailboxId: mailbox.id,
      uid: String(uid),
      fromAddr: from,
      subject,
      fileName,
      mime: mime || guessMimeFromName(fileName),
      storageBucket: up.bucket,
      storagePath: up.path,
      campaignId: campaign.id,
      reason: 'pending_sheet',
    });
    if (!inserted) {
      throw new Error(
        'pending_sheet_row_not_persisted — ligne imap_unmatched_cvs non écrite, CV re-présenté au prochain poll',
      );
    }
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
        pendingScoringSheet: true,
        stored: true,
        storagePath: up.path,
        matchSource,
        attempt: retryAttempt,
        reason:
          'fiche de scoring non validée — CV stocké, analysé automatiquement à la validation de la fiche',
      },
    });
    return 'pending_sheet';
  }

  // Journal — received (analyse en cours).
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
      pendingScoringSheet: false,
      matchSource,
      attempt: retryAttempt,
    },
  });

  // Convertit le Buffer en File pour extractCVText (qui attend File).
  // Un échec d'extraction remonte TEL QUEL (surtout pas ré-enveloppé dans un
  // `new Error(...)` : cause de l'incident 07/2026 — le wrap détruisait le
  // type `CVExtractError` avant `classifyProcessingError`, un docx illisible
  // partait en retry au lieu d'être classé PERMANENT et mis de côté).
  const file = new File([new Uint8Array(buffer)], fileName, { type: mime });
  const extracted = await extractCVText(file);

  // Pipeline extraction → scoring (code) → narration. Le LLM ne note jamais.
  const { application, isCv } = await analyzeCVApplication({
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

  // « Un mail = une candidature » : PJ classée non-CV (lettre APEC, doc
  // annexe) alors qu'il reste des PJ candidates → on s'arrête AVANT toute
  // persistance (pas de ligne « Candidat anonyme » qui occuperait l'id
  // `can_imap_<mailbox>_<uid>` en insert-only et jetterait l'analyse du vrai
  // CV en `already_exists` — incident Malaka 30/07/2026). Trace explicite,
  // jamais un skip muet.
  if (!isCv && skipIfNotCv) {
    await appendJournalEntry({
      action: 'imap_attachment_skipped_non_cv',
      actor: 'imap_poller',
      campaignId: isTaskOwner ? null : campaign.id,
      payload: {
        mailboxId: mailbox.id,
        uid,
        fileName,
        subject,
        from,
        taskId: isTaskOwner ? campaign.id : undefined,
        matchSource,
        reason:
          'PJ classée non-CV (lettre/document annexe) — la candidature du mail sera portée par une autre PJ',
      },
    }).catch(() => {});
    return 'not_a_cv';
  }

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
  // STRICT (plus best-effort) : la suite du pipeline met en file une
  // validation rattachée à CETTE analyse — un persist raté avalé produisait
  // une validation ORPHELINE (incohérence Bureau/menu, prod 26/07/2026).
  // Échec ⇒ re-tentable : le message entier repasse par les rails (les claims
  // deux-phases couvrent le re-traitement, jamais de double mail). Un doublon
  // (re-passe) est un succès ; Supabase absent reste toléré (démo volatile).
  try {
    await persistCandidateAnalysisStrict({
      id: imapAnalysisId(mailbox.id, uid),
      // uid brut = clé des marqueurs de parcours du journal (cohérent avec
      // le payload.uid de imap_cv_analyzed → dashboard).
      uid: String(uid),
      campaignId: isTaskOwner ? null : campaign.id,
      application,
    });
  } catch (err) {
    throw new RetryablePollError(
      `candidate_analysis_unpersisted: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
    imapAnalysisId(mailbox.id, uid),
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
    // Id déterministe → UPSERT obligatoire : une re-passe (retry) re-persiste
    // le même artefact ; un INSERT brut échouait en doublon et perdait le lien.
    await upsertArtifactMeta({
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
  return 'processed';
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
    // Même règle que le CV nominal : id déterministe ⇒ upsert (re-passe sûre).
    await upsertArtifactMeta({
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
        pollMailbox(mb).catch(async (err) => {
          // Un crash de poll n'est JAMAIS silencieux (l'incident 24/07/2026
          // a tourné 3 jours sans une ligne de log) : trace console + écrit
          // dans `last_error` (visible dans /api/imap/status et l'admin).
          const message = err instanceof Error ? err.message || err.name : String(err);
          console.error(`[imap-poller] poll crashé pour ${mb.id}`, err);
          await updateMailboxPollState(mb.id, {
            lastError: `poll_crashed: ${message}`,
          }).catch(() => {});
          return {
            mailboxId: mb.id,
            processed: 0,
            matched: 0,
            errors: 1,
            newLastUid: mb.last_uid_seen,
            _crashed: message,
          };
        }) as Promise<PollOutcome>,
      ),
    );
  } finally {
    globalThis.__imapPollInFlight__ = false;
  }
}
