/**
 * POST /api/campaigns/[id]/vivier-preselection/invite — « Inviter » un profil
 * du vivier depuis la campagne : il devient une candidature à part entière et
 * reçoit l'invitation avec son lien de réservation
 * (fix/vivier-replanif-filtres, point 1). Cœur : `inviteVivierCandidate`.
 *
 * L'AUTEUR vient de la session serveur, jamais du corps. « Écarter » reste
 * sur `/decisions` : rien n'y est envoyé.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { repechageToPreselection } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { inviteVivierCandidate, type VivierInviteRefusal } from '@/lib/vivier/invite-candidate';

export const runtime = 'nodejs';
// Une analyse sur la grille (quelques dizaines de secondes) précède l'envoi.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  candidateId: z.string().min(1),
  /**
   * Profil trouvé par la recherche PAR MOT-CLÉ : il n'est pas (ou plus) dans
   * les propositions de la campagne. Il y entre d'abord (repêchage, tracé),
   * puis il est invité — en UN geste, sans passer par la liste.
   */
  matchTerm: z.string().trim().min(1).max(120).optional(),
});

const REFUSALS: Record<VivierInviteRefusal, { status: number; message: string }> = {
  not_found: { status: 404, message: 'Profil ou campagne introuvable.' },
  campaign_not_active: { status: 409, message: 'La campagne n’est pas active : aucune invitation ne peut partir.' },
  sheet_not_validated: { status: 409, message: 'La grille de la campagne n’est pas validée.' },
  no_link: { status: 409, message: 'Aucun lien de réservation ne peut être émis pour cette campagne (référent, disponibilités ou lieu d’entretien).' },
  no_email: { status: 409, message: 'Ce profil n’a pas d’adresse : impossible de l’inviter.' },
  not_proposed: { status: 409, message: 'Ce profil n’est plus proposé sur cette campagne.' },
  already_decided: { status: 409, message: 'Ce profil a déjà été écarté ou contacté.' },
  in_progress: { status: 409, message: 'Une invitation est déjà en cours pour ce profil.' },
  analysis_unavailable: { status: 503, message: 'L’analyse du CV est indisponible pour le moment. Rien n’a été envoyé — réessayez dans quelques minutes.' },
  cv_unreadable: { status: 422, message: 'Le CV de ce profil est illisible. Rien n’a été envoyé.' },
};

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id: campaignId } = await context.params;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const user = await getApiUser();
    if (body.matchTerm) {
      const membership = await repechageToPreselection(campaignId, body.candidateId, body.matchTerm);
      if (membership === 'identified') {
        await appendJournalEntry({
          action: 'vivier_repechage',
          actor: 'user',
          campaignId,
          payload: { candidateId: body.candidateId, matchTerm: body.matchTerm },
        }).catch(() => {});
      }
    }
    const outcome = await inviteVivierCandidate({
      campaignId,
      vivierCandidateId: body.candidateId,
      actor: { id: user?.id ?? null, email: user?.email ?? null },
    });
    if (outcome.kind === 'refused') {
      const r = REFUSALS[outcome.reason];
      return NextResponse.json({ error: outcome.reason, message: r.message }, { status: r.status });
    }
    return NextResponse.json({ analysisId: outcome.analysisId, mail: outcome.mail, created: outcome.created });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[vivier-invite] échec', err);
    return NextResponse.json(
      { error: 'invite_failed', message: 'L’invitation n’a pas abouti. Réessayer n’enverra jamais un second message.' },
      { status: 500 },
    );
  }
}
