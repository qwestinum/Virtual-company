/**
 * GET /api/cron/imap-poll — relève des candidatures par mail, déclenchée par
 * le CRON VERCEL (juin 2026).
 *
 * Pourquoi un cron plutôt que le `setInterval` de boot : sur Vercel serverless,
 * un timer lancé au démarrage ne survit pas et d'anciennes instances rejouent
 * du code périmé (double traitement). Une requête de cron, elle, frappe
 * TOUJOURS le déploiement courant → code à jour garanti. Cf.
 * src/lib/imap/scheduler.ts (le timer reste actif en dev/VPS uniquement).
 *
 * Sécurité : FAIL-CLOSED (I13). La route est publique dans le proxy (le cron
 * externe n'a pas de session) — son auth PROPRE est le Bearer CRON_SECRET :
 *   - variable ABSENTE ⇒ 500 `cron_not_configured`, on ne polle JAMAIS sans
 *     authentification (⚠️ poser CRON_SECRET sur l'environnement AVANT de
 *     déployer ce code, sinon la relève s'arrête — runbook multi-utilisateur) ;
 *   - comparaison en temps constant (timingSafeEqual).
 */
import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { pollAllMailboxes } from '@/lib/imap/poller';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Égalité en temps constant, tolérante aux longueurs différentes. */
function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeEquals(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const outcomes = await pollAllMailboxes();
    return NextResponse.json({
      ok: true,
      polledAt: new Date().toISOString(),
      mailboxesPolled: outcomes.length,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'poll_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
