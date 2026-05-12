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
 * Limitation à connaître : `setInterval` vit dans le process Node
 * du dev/prod server. En `next dev` et `next start` (VPS), ça
 * tourne. En serverless (Vercel), ça ne survit pas — il faudra
 * basculer sur un cron Supabase ou équivalent.
 */

import { pollAllMailboxes } from '@/lib/imap/poller';

const POLL_INTERVAL_MS = 30_000;

declare global {
  /* eslint-disable-next-line no-var */
  var __imapSchedulerHandle__: NodeJS.Timeout | undefined;
  /* eslint-disable-next-line no-var */
  var __imapSchedulerStartedAt__: string | undefined;
  /* eslint-disable-next-line no-var */
  var __imapSchedulerLastRun__: string | undefined;
}

export function ensureSchedulerStarted(): {
  alreadyRunning: boolean;
  startedAt: string;
} {
  if (globalThis.__imapSchedulerHandle__) {
    return {
      alreadyRunning: true,
      startedAt: globalThis.__imapSchedulerStartedAt__ ?? '',
    };
  }
  const startedAt = new Date().toISOString();
  globalThis.__imapSchedulerStartedAt__ = startedAt;

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
  }
}
