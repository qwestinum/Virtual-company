/**
 * Authentification des routes de cron — FAIL-CLOSED (I13), en un seul endroit.
 *
 * Les routes de cron sont publiques dans le proxy (l'appelant externe n'a pas
 * de session) ; leur authentification propre est le Bearer `CRON_SECRET` :
 *   - variable ABSENTE ⇒ 500 `cron_not_configured` : on ne lance JAMAIS un
 *     traitement sans authentification ;
 *   - comparaison en temps constant.
 *
 * Rend `null` si l'appel est autorisé, sinon la réponse à renvoyer telle quelle.
 */
import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeEquals(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
