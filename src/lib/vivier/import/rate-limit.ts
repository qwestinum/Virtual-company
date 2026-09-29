/**
 * Limites de débit du fournisseur (429) pendant un import — PUR sauf `sleep`.
 *
 * Le SDK retente déjà (backoff + `Retry-After`) ; sur une organisation à bas
 * palier, un import de milliers de CV épuise pourtant ces reprises. Cette
 * seconde ceinture, reprise de l'ancien `import:vivier`, respecte l'indice
 * « try again in Xs » et fait s'auto-réguler l'import au lieu d'échouer en
 * masse. Elle ne reprend QUE les 429 : toute autre erreur remonte.
 */

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Compte SANS CRÉDIT : le fournisseur répond aussi en 429, mais attendre n'y
 * change rien. Import du 29/09/2026 : 206 réessais pendant près d'une heure
 * avant de s'avouer vaincu. Ce n'est pas une limite de débit.
 */
export function isQuotaExhausted(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /insufficient_quota|credit_balance_exhausted|no credits remaining|exceeded your current quota/iu.test(msg);
}

export function isRateLimit(msg: string | null | undefined): boolean {
  if (!msg || isQuotaExhausted(msg)) return false;
  return /\b429\b|rate limit|too many requests/iu.test(msg);
}

/** Délai suggéré par le fournisseur (« try again in 2.548s »), en ms. */
export function parseRetryAfterMs(msg: string): number | null {
  const m = msg.match(/try again in\s+([\d.]+)\s*s/iu);
  if (!m) return null;
  const s = Number(m[1]);
  return Number.isFinite(s) ? Math.ceil(s * 1000) : null;
}

/** Indice du fournisseur + marge, sinon exponentiel borné à 60 s ; sans aléa (testable). */
export function backoffMs(msg: string, attempt: number): number {
  const hinted = parseRetryAfterMs(msg);
  return hinted != null ? hinted + 750 : Math.min(60_000, 2_000 * 2 ** (attempt - 1));
}

export function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

export async function withRateLimitRetry<T>(
  maxRetries: number,
  fn: () => Promise<T>,
  onWait: (ms: number, attempt: number) => void = () => {},
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = errMsg(err);
      if (!isRateLimit(msg) || attempt > maxRetries) throw err;
      const ms = backoffMs(msg, attempt) + Math.floor(Math.random() * 500);
      onWait(ms, attempt);
      await wait(ms);
    }
  }
}
