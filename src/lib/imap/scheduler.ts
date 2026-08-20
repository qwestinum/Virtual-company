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
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';

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
}

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

  // Premier tick immédiat (ne pas attendre 30s au boot). Puis tous
  // les POLL_INTERVAL_MS.
  void runTick();
  globalThis.__imapSchedulerHandle__ = setInterval(() => {
    void runTick();
  }, POLL_INTERVAL_MS);

  return { alreadyRunning: false, startedAt };
}

async function runTick(): Promise<void> {
  globalThis.__imapSchedulerLastRun__ = new Date().toISOString();
  try {
    await pollAllMailboxes();
    // Même rail qu'en production (cf. /api/cron/imap-poll) : sans lui, un
    // rendez-vous pris en local ne délivrerait jamais son briefing.
    await drainSchedulingEvents();
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
} {
  return {
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
  }
}
