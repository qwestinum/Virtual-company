/**
 * Limitation de débit des surfaces publiques.
 *
 * Le compteur vit EN BASE, pas en mémoire. Une page de réservation est
 * anonyme : sa seule authentification est le jeton d'URL. Or sur une plateforme
 * qui répartit les requêtes entre instances isolées, un compteur en mémoire de
 * process ne voit qu'une fraction du trafic — il rassure sans protéger. La
 * seule chose partagée entre instances est la base ; le compteur y est donc.
 *
 * Fenêtre FIXE, incrémentée par une fonction SQL atomique : un
 * SELECT-puis-UPDATE laisserait passer les rafales concurrentes, c'est-à-dire
 * exactement ce qu'on cherche à arrêter.
 *
 * Politique de panne : si le compteur est INJOIGNABLE, on LAISSE PASSER. Un
 * hoquet de base ne doit pas empêcher quelqu'un de confirmer son rendez-vous —
 * la limitation protège d'un abus, elle n'est pas un contrôle d'accès (celui-là,
 * c'est le jeton, et il ne dépend pas d'elle).
 */
import { SchedulingStoreError } from './errors';
import { db, rateLimits } from './runtime';

/** Ce qu'on limite. Chaque action a son propre budget. */
export type RateLimitedAction = 'slots' | 'book' | 'manage';

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitVerdict = {
  allowed: boolean;
  /** Secondes avant la fin de la fenêtre courante — pour l'en-tête Retry-After. */
  retryAfterSeconds: number;
};

/**
 * Deux portées par action, appliquées ensemble :
 *   - par ADRESSE, contre le balayage d'URL par un tiers ;
 *   - par JETON, contre l'acharnement sur un seul lien (y compris derrière un
 *     partage d'adresse, où la limite par IP serait trop large ou trop étroite).
 */
export type RateLimitPolicy = Record<RateLimitedAction, { ip: RateLimitRule; token: RateLimitRule }>;

export const DEFAULT_RATE_LIMITS: RateLimitPolicy = {
  // Lire des créneaux est bon marché : on laisse naviguer entre les semaines.
  slots: {
    ip: { limit: 120, windowSeconds: 60 },
    token: { limit: 120, windowSeconds: 60 },
  },
  // Réserver écrit, envoie des messages, et n'arrive qu'une fois par lien.
  book: {
    ip: { limit: 10, windowSeconds: 60 },
    token: { limit: 8, windowSeconds: 60 },
  },
  // Déplacer / annuler : rare, mais on tolère l'hésitation.
  manage: {
    ip: { limit: 20, windowSeconds: 60 },
    token: { limit: 20, windowSeconds: 60 },
  },
};

const ALLOWED: RateLimitVerdict = { allowed: true, retryAfterSeconds: 0 };

/**
 * Consomme un jeton de débit pour cette action. `ip` absente (appel interne,
 * en-tête manquant) ⇒ seule la portée jeton s'applique.
 */
export async function consumeRateLimit(params: {
  action: RateLimitedAction;
  token: string;
  ip?: string | null;
  now: Date;
}): Promise<RateLimitVerdict> {
  const policy = rateLimits()[params.action];

  const scopes: { rule: RateLimitRule; key: string }[] = [
    { rule: policy.token, key: `${params.action}:t:${params.token}` },
  ];
  if (params.ip) {
    scopes.push({ rule: policy.ip, key: `${params.action}:i:${params.ip}` });
  }

  for (const scope of scopes) {
    const verdict = await hit(scope.key, scope.rule, params.now);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/** Début de la fenêtre courante — aligné, donc identique pour tous les appelants. */
function windowStart(now: Date, windowSeconds: number): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

async function hit(
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<RateLimitVerdict> {
  const start = windowStart(now, rule.windowSeconds);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((start.getTime() + rule.windowSeconds * 1000 - now.getTime()) / 1000),
  );

  try {
    const { data, error } = await db().rpc('sched_rate_limit_hit', {
      p_key: key,
      p_window_start: start.toISOString(),
      p_limit: rule.limit,
    });
    if (error) throw new SchedulingStoreError('rateLimit', error.message, error.code);
    // La fonction rend `true` tant que le budget n'est pas dépassé.
    return data === false ? { allowed: false, retryAfterSeconds } : ALLOWED;
  } catch {
    // Compteur injoignable ⇒ on laisse passer (cf. l'en-tête du fichier).
    return ALLOWED;
  }
}

/**
 * Supprime les fenêtres périmées. Rattachée au drain d'événements : une table
 * de compteurs qui grossit sans fin est une fuite lente, et un mécanisme dédié
 * pour la purger serait un rouage de plus à surveiller.
 */
export async function purgeExpiredRateLimits(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 3_600_000).toISOString();
  try {
    const { data, error } = await db()
      .from('sched_rate_limits')
      .delete()
      .lt('window_start', cutoff)
      .select('bucket_key');
    if (error) return 0;
    return (data ?? []).length;
  } catch {
    return 0;
  }
}
