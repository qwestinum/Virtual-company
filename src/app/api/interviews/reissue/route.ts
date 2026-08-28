/**
 * POST /api/interviews/reissue — renvoyer un lien de réservation.
 *
 * Le geste HUMAIN qui répond à une annulation candidat (`reinvite`) ou à une
 * replanification décidée par le cabinet (`reschedule`). V1 n'en fait JAMAIS
 * un automatisme : un candidat qui annule a peut-être renoncé, et lui renvoyer
 * un lien dans la seconde serait déplacé. On signale, quelqu'un décide.
 *
 * En `reschedule`, l'annulation et la réinvitation sont faites ICI, dans le
 * même appel : enchaînées depuis l'écran, un échec réseau au milieu laissait
 * le candidat décommandé et jamais réinvité — et il recevait deux messages,
 * dont un qui lui réannonçait qu'il était retenu.
 *
 * Un lien est à usage unique : la réinvitation crée une NOUVELLE génération de
 * clé. Ré-émettre avec la clé d'origine rendrait fidèlement le jeton consommé.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { reissueBookingLink } from '@/lib/interviews/reissue';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  analysisId: z.string().min(1),
  /** `reschedule` décommande d'abord ; `reinvite` suppose le créneau déjà tombé. */
  kind: z.enum(['reschedule', 'reinvite']).default('reinvite'),
});

const MESSAGES: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: 'Candidature introuvable.' },
  dismissed: {
    status: 409,
    message: 'Cette candidature est classée sans suite — rouvre-la d’abord.',
  },
  not_native: {
    status: 409,
    message:
      'Cette campagne n’est pas en réservation native : le lien d’agenda est celui des paramètres.',
  },
  no_candidate_email: { status: 422, message: 'Pas d’adresse candidat connue.' },
  link_unavailable: {
    status: 503,
    message:
      'Impossible d’émettre un lien : le référent de la campagne n’a pas de disponibilités configurées.',
  },
};

/**
 * Le motif précis quand il en existe un. « Pas de disponibilités » et « pas de
 * lieu » se réparent dans deux blocs différents du même écran : renvoyer le
 * message générique enverrait chercher au mauvais endroit.
 */
const LINK_UNAVAILABLE_MESSAGES: Record<string, string> = {
  meeting_location_missing:
    'Impossible d’émettre un lien : aucun lieu d’entretien n’est renseigné (agenda du référent ou lieu de la campagne).',
  agenda_link_not_configured: 'Lien d’agenda non configuré dans les paramètres.',
};

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await reissueBookingLink({
      analysisId: parsed.analysisId,
      kind: parsed.kind,
      actorUserId: user.id,
    });

    const known = MESSAGES[outcome.status];
    if (known) {
      const detail =
        'error' in outcome && outcome.error
          ? LINK_UNAVAILABLE_MESSAGES[outcome.error]
          : undefined;
      return NextResponse.json(
        { error: outcome.status, message: detail ?? known.message },
        { status: known.status },
      );
    }

    // L'annulation a produit un événement : on pousse le drain pour que
    // l'écran se remette à jour tout de suite plutôt qu'au prochain cron.
    if (parsed.kind === 'reschedule') after(() => drainSchedulingEvents());

    return NextResponse.json({
      status: outcome.status,
      error: 'error' in outcome ? (outcome.error ?? null) : null,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'reissue_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
