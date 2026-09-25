/**
 * Échéance de relève d'une boîte — PUR (diagnostic d'egress du 25/09/2026).
 *
 * Deux releveurs pouvaient viser la même base (minuteur local de 30 s + cron
 * externe à la minute) : chacun relevait CHAQUE boîte à CHAQUE passage. Une
 * boîte est désormais relevée au plus une fois par `MAILBOX_POLL_INTERVAL_MS`,
 * quel que soit le releveur — l'échéance se lit sur `last_polled_at`, en base,
 * seule mémoire partagée entre processus.
 *
 * L'intervalle est un peu plus COURT que la cadence du cron (60 s) : avec 60 s
 * pile, la gigue du déclencheur ferait trouver la boîte « pas encore due » un
 * passage sur deux, et le cron ne relèverait plus qu'une fois toutes les deux
 * minutes.
 */

export const MAILBOX_POLL_INTERVAL_MS = 50_000;

/** Une boîte jamais relevée, ou relevée depuis au moins l'intervalle, est due. */
export function isMailboxDue(lastPolledAt: string | null, nowMs: number, intervalMs = MAILBOX_POLL_INTERVAL_MS): boolean {
  if (!lastPolledAt) return true;
  const last = Date.parse(lastPolledAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= intervalMs;
}

/**
 * Quand relire la base : à la PREMIÈRE échéance parmi les boîtes connues.
 * `polledNow` = boîtes relevées à l'instant (leur `last_polled_at` lu est
 * périmé). Sans boîte connue, on relit à l'intervalle — une boîte activée
 * entre-temps doit être découverte.
 */
export function nextReadAt(
  mailboxes: { id: string; lastPolledAt: string | null }[],
  polledNow: ReadonlySet<string>,
  nowMs: number,
  intervalMs = MAILBOX_POLL_INTERVAL_MS,
): number {
  if (mailboxes.length === 0) return nowMs + intervalMs;
  let next = Number.POSITIVE_INFINITY;
  for (const m of mailboxes) {
    const last = polledNow.has(m.id) ? nowMs : m.lastPolledAt ? Date.parse(m.lastPolledAt) : Number.NaN;
    const due = Number.isNaN(last) ? nowMs : last + intervalMs;
    next = Math.min(next, due);
  }
  // Jamais dans le passé, et jamais plus tard que l'intervalle : une boîte
  // ajoutée entre deux lectures est découverte au plus tard à ce moment-là.
  return Math.min(Math.max(next, nowMs), nowMs + intervalMs);
}
