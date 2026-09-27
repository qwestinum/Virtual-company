/**
 * Garde PAR PROJET des routes de cron — Vercel Cron Jobs (27/09/2026).
 *
 * `vercel.json` est COMMUN à tous les déploiements (dev, démo, clients) : chaque
 * projet Vercel qui le déploie en production déclenche ses crons. La règle « un
 * seul déclencheur par base » (la dev partage sa base avec la démo, et le
 * minuteur local la relève aussi) reste donc du CODE : une route de cron ne
 * travaille que si le projet porte `CRON_ENABLED=1`, exactement. Sinon elle
 * répond 200 `{ enabled: false }` IMMÉDIATEMENT — aucune lecture, aucune
 * écriture, aucun journal.
 *
 * Posée AVANT l'authentification, à dessein : un projet sans `CRON_ENABLED`
 * (la dev) n'a pas forcément de `CRON_SECRET` ; l'authentification d'abord y
 * produirait une erreur 500 à chaque minute pour une route qui n'a rien à
 * faire. Ne répondre que `enabled: false` ne révèle rien d'utile.
 *
 * Valeur STRICTE : `1` seulement. `true`, `yes`, vide ⇒ désactivé — un cron qui
 * relève une base par erreur coûte plus cher qu'un cron qui ne tourne pas.
 */
import { NextResponse } from 'next/server';

export function isCronEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.CRON_ENABLED === '1';
}

/** `null` si les crons sont actifs sur ce projet, sinon la réponse à renvoyer telle quelle. */
export function cronDisabledResponse(env: Readonly<Record<string, string | undefined>> = process.env): NextResponse | null {
  return isCronEnabled(env) ? null : NextResponse.json({ enabled: false });
}
