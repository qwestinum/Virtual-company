/**
 * Activité utilisateur et pause du minuteur LOCAL de relève (diagnostic
 * d'egress du 25/09/2026).
 *
 * Un `next dev` laissé ouvert relevait les boîtes toutes les 30 s, jour et
 * nuit, sur une base partagée avec le cron externe : ~360 Mo/jour sortis pour
 * personne. Le minuteur se met en PAUSE après 15 minutes sans requête
 * utilisateur et REPREND à la première requête suivante — sans variable
 * d'environnement : un poste où personne ne travaille n'a rien à relever, le
 * cron s'en charge.
 *
 * Ce module est importé par le PROXY : il ne tire AUCUNE dépendance (ni base,
 * ni poller) — un simple horodatage et un réveil, posés sur `globalThis`, seul
 * état partagé entre le proxy et le minuteur dans un même processus. Sur
 * Vercel, il n'y a pas de minuteur : le réveil est absent, l'horodatage ne
 * sert à rien et ne coûte rien.
 */

declare global {
  var __orqaLastUserRequestAt__: number | undefined;
  var __imapSchedulerWake__: (() => void) | undefined;
}

/** Sans requête utilisateur depuis ce délai, le minuteur local se met en pause. */
export const LOCAL_SCHEDULER_IDLE_MS = 15 * 60_000;

/** Les déclenchements automatiques ne sont pas de l'activité utilisateur. */
export function isUserRequestPath(pathname: string): boolean {
  return !pathname.startsWith('/api/cron/');
}

/** Appelé par le proxy à chaque requête : horodate, et réveille un minuteur en pause. */
export function noteUserRequest(pathname: string, nowMs = Date.now()): void {
  if (!isUserRequestPath(pathname)) return;
  globalThis.__orqaLastUserRequestAt__ = nowMs;
  globalThis.__imapSchedulerWake__?.();
}

export function lastUserRequestAt(): number | undefined {
  return globalThis.__orqaLastUserRequestAt__;
}

export type SchedulerDecision = 'run' | 'pause' | 'skip' | 'resume';

/**
 * Ce que fait un tick du minuteur local. PUR.
 * - actif et utilisé récemment → `run` ;
 * - actif mais inactif depuis le délai → `pause` (journalisé une fois) ;
 * - en pause et toujours inactif → `skip` (aucune lecture) ;
 * - en pause et une requête est arrivée → `resume` (journalisé), puis relève.
 */
export function schedulerDecision(args: {
  nowMs: number;
  lastUserRequestAtMs: number;
  paused: boolean;
  idleMs?: number;
}): SchedulerDecision {
  const idle = args.nowMs - args.lastUserRequestAtMs >= (args.idleMs ?? LOCAL_SCHEDULER_IDLE_MS);
  if (args.paused) return idle ? 'skip' : 'resume';
  return idle ? 'pause' : 'run';
}
