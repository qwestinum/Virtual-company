/**
 * Scheduler IMAP — démarre le polling périodique (Session 5 round 5).
 *
 * Lazy init : démarré au premier hit d'une route API mailboxes (cf.
 * `ensureSchedulerStarted` appelé dans les handlers). Pas de
 * polling tant qu'aucune mailbox n'a été touchée — évite de lancer
 * du I/O au boot quand l'app tourne en démo locale.
 *
 * Garde anti-doublon : un flag sur `globalThis` survit aux
 * hot-reloads de Next.js dev (chaque hot-reload re-importe le
 * module, ce qui réinitialiserait un module-local). Sans cette
 * précaution, on lance N timers en parallèle après quelques edits.
 *
 * ⚠️ Cette garde a un revers, découvert le 17/08/2026 : elle gardait le
 * minuteur d'ORIGINE. Or un `setInterval` capture le graphe de modules du
 * moment où il a été posé — une recompilation ne le remplace pas. Le poller
 * continuait donc d'exécuter le code du démarrage pendant que les routes,
 * elles, servaient le code à jour : le chemin chat émettait un lien de
 * réservation natif, le chemin mail partait encore sur l'agenda externe.
 * Symptôme illisible (« la campagne est configurée mais les invitations ne
 * suivent pas »), sans rien d'anormal en base.
 *
 * On REMPLACE donc le minuteur quand le module a été ré-évalué : toujours un
 * seul timer, mais qui exécute le code courant.
 *
 * Limitation à connaître : `setInterval` vit dans le process Node
 * du dev/prod server. En `next dev` et `next start` (VPS), ça
 * tourne. En serverless (Vercel), ça ne survit pas — il faudra
 * basculer sur un cron Supabase ou équivalent.
 */

import { pollAllMailboxes } from '@/lib/imap/poller';
import { runQueuedClosureDismissals } from '@/lib/candidatures/dismissal-batch';
import { runSourcingMaintenance } from '@/lib/sourcing/server/maintenance';
import { runVivierIndexingMaintenance } from '@/lib/vivier/maintenance';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { lastUserRequestAt, LOCAL_SCHEDULER_IDLE_MS, schedulerDecision } from '@/lib/imap/user-activity';

const POLL_INTERVAL_MS = 30_000;

/**
 * Identité de CETTE évaluation du module. Recréée à chaque recompilation :
 * comparée à celle mémorisée, elle dit si le minuteur en place tourne sur du
 * code périmé.
 */
const MODULE_INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

declare global {
  var __imapSchedulerHandle__: NodeJS.Timeout | undefined;
  var __imapSchedulerStartedAt__: string | undefined;
  var __imapSchedulerLastRun__: string | undefined;
  var __imapSchedulerInstance__: string | undefined;
  /** Début de la pause en cours (ms), `undefined` si le minuteur relève. */
  var __imapSchedulerPausedSince__: number | undefined;
  var __imapSchedulerTickRunning__: boolean | undefined;
}

/**
 * PAUSE SANS ACTIVITÉ (diagnostic d'egress du 25/09/2026) : en DÉVELOPPEMENT
 * seulement. Sous `next start` (un VPS de production), une pause la nuit, faute
 * de visite, arrêterait la réception des CV — là, le minuteur est le releveur
 * et doit tourner sans public. En `next dev`, le cron externe relève déjà la
 * base partagée : un poste où personne ne travaille n'a rien à relever.
 */
const PAUSES_WHEN_IDLE = process.env.NODE_ENV === 'development';

export function ensureSchedulerStarted(): {
  alreadyRunning: boolean;
  startedAt: string;
} {
  // Serverless (Vercel) : un `setInterval` lancé au boot ne survit pas
  // proprement et d'ANCIENNES instances « tièdes » continuent de tourner avec
  // du code périmé (→ double traitement / ancien briefing). On NE démarre donc
  // PAS le timer ici sur Vercel : le polling passe par le cron Vercel
  // (vercel.json → GET /api/cron/imap-poll), qui poll via une REQUÊTE et frappe
  // donc TOUJOURS le déploiement courant. En dev/VPS (`next dev`/`next start`),
  // le timer reste la voie normale.
  if (process.env.VERCEL) {
    return { alreadyRunning: true, startedAt: '' };
  }
  if (globalThis.__imapSchedulerHandle__) {
    // Même code : rien à faire, un seul minuteur suffit.
    if (globalThis.__imapSchedulerInstance__ === MODULE_INSTANCE) {
      return {
        alreadyRunning: true,
        startedAt: globalThis.__imapSchedulerStartedAt__ ?? '',
      };
    }
    // Code recompilé : on remplace. Le tick en cours va au bout (il tourne
    // déjà), les suivants exécuteront la version courante.
    clearInterval(globalThis.__imapSchedulerHandle__);
    globalThis.__imapSchedulerHandle__ = undefined;
    console.info('[imap-scheduler] code rechargé — minuteur remplacé');
  }
  const startedAt = new Date().toISOString();
  globalThis.__imapSchedulerStartedAt__ = startedAt;
  globalThis.__imapSchedulerInstance__ = MODULE_INSTANCE;

  // L'activité démarre au lancement : un serveur qu'on vient d'ouvrir relève
  // pendant 15 minutes, même sans visite.
  globalThis.__orqaLastUserRequestAt__ ??= Date.now();
  // Réveil appelé par le proxy à chaque requête utilisateur : un minuteur en
  // pause reprend TOUT DE SUITE, sans attendre son prochain tick.
  globalThis.__imapSchedulerWake__ = () => {
    if (globalThis.__imapSchedulerPausedSince__ !== undefined) void runTick();
  };

  // Premier tick immédiat (ne pas attendre 30s au boot). Puis tous
  // les POLL_INTERVAL_MS.
  void runTick();
  globalThis.__imapSchedulerHandle__ = setInterval(() => {
    void runTick();
  }, POLL_INTERVAL_MS);

  return { alreadyRunning: false, startedAt };
}

/** Pause / reprise, journalisées. Rend `true` si ce tick doit relever. */
async function applyIdlePolicy(): Promise<boolean> {
  if (!PAUSES_WHEN_IDLE) return true;
  const now = Date.now();
  const last = lastUserRequestAt() ?? now;
  const pausedSince = globalThis.__imapSchedulerPausedSince__;
  const decision = schedulerDecision({ nowMs: now, lastUserRequestAtMs: last, paused: pausedSince !== undefined });
  if (decision === 'skip') return false;
  if (decision === 'pause') {
    globalThis.__imapSchedulerPausedSince__ = now;
    console.info('[imap-scheduler] pause — aucune requête utilisateur depuis 15 min');
    await appendJournalEntry({
      action: 'imap_local_scheduler_paused',
      actor: 'imap_scheduler',
      payload: {
        idleMinutes: Math.round((now - last) / 60_000),
        lastUserRequestAt: new Date(last).toISOString(),
        idleThresholdMinutes: LOCAL_SCHEDULER_IDLE_MS / 60_000,
      },
    }).catch(() => {});
    return false;
  }
  if (decision === 'resume' && pausedSince !== undefined) {
    globalThis.__imapSchedulerPausedSince__ = undefined;
    console.info('[imap-scheduler] reprise — requête utilisateur');
    await appendJournalEntry({
      action: 'imap_local_scheduler_resumed',
      actor: 'imap_scheduler',
      payload: {
        pausedSince: new Date(pausedSince).toISOString(),
        pausedMinutes: Math.round((now - pausedSince) / 60_000),
      },
    }).catch(() => {});
  }
  return true;
}

async function runTick(): Promise<void> {
  // Un réveil peut tomber pendant un tick : jamais deux ticks à la fois.
  if (globalThis.__imapSchedulerTickRunning__) return;
  globalThis.__imapSchedulerTickRunning__ = true;
  try {
    if (!(await applyIdlePolicy())) return;
    await runTickBody();
  } finally {
    globalThis.__imapSchedulerTickRunning__ = false;
  }
}

async function runTickBody(): Promise<void> {
  globalThis.__imapSchedulerLastRun__ = new Date().toISOString();
  try {
    await pollAllMailboxes();
    // Même rail qu'en production (cf. /api/cron/imap-poll) : sans lui, un
    // rendez-vous pris en local ne délivrerait jamais son briefing.
    await drainSchedulingEvents();
    await runSourcingMaintenance();
    await runVivierIndexingMaintenance();
    await runQueuedClosureDismissals();
  } catch (err) {
    // Le poll capture déjà les erreurs par mailbox. Ce catch
    // protège contre un crash en dehors (Supabase down, etc.). On
    // log mais on ne kill jamais le scheduler.
    console.error('[imap-scheduler] tick failed', err);
  }
}

export function getSchedulerStatus(): {
  running: boolean;
  startedAt: string | null;
  lastRun: string | null;
  intervalMs: number;
  pausedSince: string | null;
} {
  const paused = globalThis.__imapSchedulerPausedSince__;
  return {
    pausedSince: paused !== undefined ? new Date(paused).toISOString() : null,
    running: Boolean(globalThis.__imapSchedulerHandle__),
    startedAt: globalThis.__imapSchedulerStartedAt__ ?? null,
    lastRun: globalThis.__imapSchedulerLastRun__ ?? null,
    intervalMs: POLL_INTERVAL_MS,
  };
}

/**
 * Stoppe le scheduler — utile pour les tests, ou pour faire un
 * « purge restart » via une route admin si jamais on en ajoute une.
 */
export function stopScheduler(): void {
  if (globalThis.__imapSchedulerHandle__) {
    clearInterval(globalThis.__imapSchedulerHandle__);
    globalThis.__imapSchedulerHandle__ = undefined;
    globalThis.__imapSchedulerStartedAt__ = undefined;
    globalThis.__imapSchedulerInstance__ = undefined;
    globalThis.__imapSchedulerWake__ = undefined;
    globalThis.__imapSchedulerPausedSince__ = undefined;
  }
}
