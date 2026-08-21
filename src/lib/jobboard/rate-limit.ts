/**
 * Limitation de débit du formulaire de candidature public.
 *
 * Le compteur vit EN BASE, pas en mémoire de process — même raison que pour les
 * pages de réservation : sur une plateforme qui répartit les requêtes entre
 * instances isolées, un compteur en mémoire ne voit qu'une fraction du trafic.
 * Il rassure sans protéger.
 *
 * On RÉUTILISE la fonction SQL atomique `sched_rate_limit_hit` et sa table.
 * Son préfixe `sched_` est un accident de naissance : la fonction n'a rien de
 * spécifique à la réservation (une clé opaque, une fenêtre, un plafond), elle
 * est déjà purgée par le drain existant, et en dupliquer une seconde à
 * l'identique pour une différence de nom serait une dette pure. Les clés sont
 * préfixées `jobs:` — aucune collision possible avec celles du module.
 *
 * ⚠️ POLITIQUE DE PANNE INVERSÉE par rapport à la réservation : ici, compteur
 * injoignable ⇒ on REFUSE. La réservation laisse passer parce que la limite n'y
 * est pas le contrôle d'accès (c'est le jeton) et qu'un refus empêcherait
 * quelqu'un de confirmer un vrai rendez-vous. Ici il n'y a aucun jeton, la
 * limite EST la seule borne, et chaque requête acceptée envoie un VRAI mail
 * avec pièce jointe. Le coût d'un refus injustifié est un nouvel essai ; celui
 * d'une rafale non bornée est un domaine d'envoi grillé.
 */

import { getServerSupabase } from '@/lib/db/supabase-server';

/** 3 candidatures par adresse et par 10 minutes : large pour un rendez-vous. */
const LIMIT = 3;
const WINDOW_SECONDS = 600;

export type RateVerdict = { allowed: boolean; retryAfterSeconds: number };

function windowStart(now: Date): Date {
  const size = WINDOW_SECONDS * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

/**
 * `ip` absente (en-tête manquant derrière un proxy inattendu) ⇒ on retombe sur
 * une clé COMMUNE plutôt que de ne rien compter : mieux vaut une limite trop
 * large partagée qu'un trou par lequel tout passe.
 */
export async function consumeApplyQuota(
  ip: string | null,
  now: Date = new Date(),
): Promise<RateVerdict> {
  const start = windowStart(now);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((start.getTime() + WINDOW_SECONDS * 1000 - now.getTime()) / 1000),
  );
  const key = `jobs:apply:${ip ?? 'unknown'}`;

  const db = getServerSupabase();
  if (!db) return { allowed: false, retryAfterSeconds };

  try {
    const { data, error } = await db.rpc('sched_rate_limit_hit', {
      p_key: key,
      p_window_start: start.toISOString(),
      p_limit: LIMIT,
    });
    if (error) return { allowed: false, retryAfterSeconds };
    return data === false
      ? { allowed: false, retryAfterSeconds }
      : { allowed: true, retryAfterSeconds: 0 };
  } catch {
    return { allowed: false, retryAfterSeconds };
  }
}

/**
 * Adresse de l'appelant. Vercel pose `x-forwarded-for` ; on ne garde que le
 * PREMIER maillon (le client), les suivants étant les proxys traversés.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || null;
}
