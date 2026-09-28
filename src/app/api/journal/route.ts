/**
 * /api/journal — append d'une entrée d'audit (Session 5, round 1).
 *
 * Spec §6.3. Pour l'instant on n'expose pas la lecture côté front
 * (debug Supabase Studio suffit). Si Supabase n'est pas configuré, on
 * répond 204 silencieux pour ne pas casser un parcours UI.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  INTERVIEW_MARKER_ACTION,
  VALIDATION_MARKER_ACTION,
} from '@/lib/candidatures/decision-markers';
import { CAMPAIGN_CLOSED_ACTION } from '@/lib/campagnes/closure-constants';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const EntrySchema = z.object({
  action: z.string().min(1),
  campaignId: z.string().min(1).nullable().optional(),
  actor: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Complète le payload avec l'identité de la session. ADDITIF et
 * NON DESTRUCTIF : un champ déjà posé par l'appelant n'est jamais écrasé.
 * Best-effort — une session illisible ne fait pas échouer l'écriture du
 * journal (perdre une trace serait pire que la perdre sans auteur).
 */
async function withActorIdentity(
  payload: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const base = payload ?? {};
  try {
    const user = await getApiUser();
    if (!user) return base;
    return {
      ...base,
      actorUserId: base.actorUserId ?? user.id,
      actorEmail: base.actorEmail ?? user.email ?? null,
    };
  } catch {
    return base;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof EntrySchema>;
  try {
    parsed = EntrySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  // Le verdict final a SON chemin, qui exige le commentaire qui le motive
  // (`POST /api/candidatures/[id]/verdict`). Sans ce refus, la règle « pas de
  // décision sans commentaire » ne serait qu'une convention d'écran.
  if (parsed.action === VALIDATION_MARKER_ACTION) {
    return NextResponse.json(
      {
        error: 'use_verdict_route',
        message:
          'Un verdict final se pose par POST /api/candidatures/[id]/verdict, avec son commentaire.',
      },
      { status: 409 },
    );
  }

  // La clôture a SON chemin, qui écrit `campaign_closed` avec l'issue et le
  // recruté : une seconde entrée, muette sur l'issue, ferait mentir le journal.
  if (parsed.action === CAMPAIGN_CLOSED_ACTION) {
    return NextResponse.json(
      {
        error: 'use_close_route',
        message: 'Une clôture se pose par POST /api/campaigns/[id]/close.',
      },
      { status: 409 },
    );
  }

  // Classer un absent NON RETENU est une décision, qui a SON chemin : elle
  // exige le choix de message au candidat (feat/feedback-candidat). Le
  // constat « entretien réalisé » reste un marquage ordinaire.
  if (parsed.action === INTERVIEW_MARKER_ACTION && parsed.payload?.status === 'missed') {
    return NextResponse.json(
      {
        error: 'use_no_show_route',
        message:
          'Une absence classée non retenue se pose par POST /api/candidatures/[id]/no-show, avec le message au candidat.',
      },
      { status: 409 },
    );
  }

  try {
    // Identité de l'auteur résolue CÔTÉ SERVEUR, jamais reçue du client.
    // `actor` reste la chaîne de rôle historique ('user'/'system') que tous
    // les lecteurs connaissent ; l'identité s'ajoute au payload sans rien
    // casser (c'est un sac). Sans ça, un marquage d'entretien n'a AUCUN
    // auteur — et un écran qui doit dire « marqué par Sarah D. » n'a que le
    // choix entre le silence et l'invention.
    await appendJournalEntry({
      ...parsed,
      payload: await withActorIdentity(parsed.payload),
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
