/**
 * GET /api/today — ce que l'écran d'accueil ne peut pas déduire tout seul :
 * le prénom du recruteur, et le compte d'activité de chaque agent depuis sa
 * dernière visite.
 *
 * Le reste d'*Aujourd'hui* (candidatures, entretiens, points à régler) vient
 * des routes des écrans de travail — c'est ce qui garantit que ses compteurs
 * égalent les leurs. Cette route n'ajoute QUE ce qui manquait.
 *
 * `since` est fourni par le client (son dernier passage). Il est borné côté
 * serveur : une valeur absente, illisible ou dans le futur retombe sur 24 h.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { countJournalEntriesByActions } from '@/lib/db/repos/journal';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { AGENT_BAND, bandWindowStart } from '@/lib/today/agents-band';

export const runtime = 'nodejs';

/** « Imad Belfaqir » → « Imad ». Une adresse ne donne pas de prénom. */
function firstName(displayName: string | null): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 0 ? first : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const since = bandWindowStart(
    new URL(request.url).searchParams.get('since'),
    Date.now(),
  );

  try {
    // Les six comptes partent ENSEMBLE : ils ne se dépendent pas, et chacun
    // est un `head: true` qui ne rapatrie aucune ligne.
    const [recruiter, ...counts] = await Promise.all([
      getRecruiter(user.id).catch(() => null),
      ...AGENT_BAND.map((a) =>
        countJournalEntriesByActions(a.actions, since).catch(() => 0),
      ),
    ]);

    return NextResponse.json(
      {
        firstName: firstName(recruiter?.displayName ?? null),
        since,
        agents: AGENT_BAND.map((a, i) => ({ id: a.id, count: counts[i] ?? 0 })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/today] GET failed', err);
    return NextResponse.json({ error: 'today_failed' }, { status: 500 });
  }
}
