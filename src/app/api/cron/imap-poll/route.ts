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
 * Sécurité : Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>` quand la
 * variable d'env `CRON_SECRET` est définie. On rejette tout appel non
 * authentifié dès lors que le secret est configuré.
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { pollAllMailboxes } from '@/lib/imap/poller';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
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
