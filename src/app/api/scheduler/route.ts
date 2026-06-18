/**
 * /api/scheduler — mise en FILE du briefing d'entretien (refonte juin 2026).
 *
 * Pour un candidat accepté, génère la trame d'entretien (6-8 questions) et la
 * MET EN ATTENTE de réservation (`interview_briefs.status = awaiting_booking`).
 * Le briefing n'est PLUS envoyé ici : il part au DRH (mail + CV en PJ) à la
 * réception du webhook Cal.com BOOKING_CREATED (cf. /api/webhooks/calcom).
 *
 * Découplage : Cal.com pose le RDV dans l'agenda du recruteur de son côté ;
 * ORQA délivre le briefing confidentiel par mail UNIQUEMENT, et seulement
 * quand le candidat a réellement réservé.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { queueInterviewBrief } from '@/lib/interview/queue-brief';
import { MailCandidateSchema } from '@/types/mail-candidate';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  campaignId: z.string().min(1),
  jobTitle: z.string().nullable(),
  candidate: MailCandidateSchema,
  /** Legacy (ignorés) — conservés pour compat des appelants existants. */
  artifactId: z.string().optional(),
  bookingUrl: z.string().url().optional(),
});
type RequestBody = z.infer<typeof RequestSchema>;

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: RequestBody;
  try {
    parsed = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  const result = await queueInterviewBrief({
    campaignId: parsed.campaignId,
    jobTitle: parsed.jobTitle,
    candidate: parsed.candidate,
    actor: 'scheduler_api',
  });

  if (result.status === 'compose_failed') {
    return NextResponse.json(
      { status: 'compose_failed', error: result.error },
      { status: 502 },
    );
  }

  // 'queued' (nominal) ou 'persist_skipped' (Supabase absent en démo) : le flux
  // d'acceptation ne doit pas échouer pour autant — on renvoie 200 avec le détail.
  return NextResponse.json({
    status: result.status,
    briefId: result.status === 'queued' ? result.briefId : null,
    error: result.status === 'persist_skipped' ? result.error : null,
  });
}
