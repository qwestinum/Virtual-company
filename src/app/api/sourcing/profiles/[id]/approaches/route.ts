/**
 * POST /api/sourcing/profiles/[id]/approaches — PRÉPARE une approche.
 *
 * Rédige le message (seul appel au modèle par profil), crée l'approche et son
 * jeton, et rend au recruteur le texte avec le VRAI lien. Rien n'est envoyé :
 * c'est le recruteur qui ouvre le profil et colle, ou ouvre sa messagerie. Le
 * profil ne passe « contacté » qu'à la confirmation de ce geste.
 *
 * Pourquoi deux temps : ouvrir un onglet et écrire dans le presse-papier
 * exigent un clic de l'utilisateur, et ce privilège ne survit pas à l'attente
 * du modèle. Le second clic, message prêt, fait les deux d'un coup.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import { getSourcingPreferences, insertSourcingApproach } from '@/lib/db/repos/sourcing-approaches';
import { schedulingBaseUrl } from '@/lib/scheduling-host/configure';
import { approachUrl, mintApproachToken } from '@/lib/sourcing/approach-token';
import { mailtoHref, MESSAGE_LIMITS, messageContextFrom, renderMessage, type MessageFormat } from '@/lib/sourcing/message';
import { composeApproachMessage } from '@/lib/sourcing/server/compose-message';
import { guardSourcingProfile } from '@/lib/sourcing/server/route-guard';
import { resolveOrganizationName } from '@/types/branding';
import { fdpJobTitle, fdpText } from '@/types/job-post';

export const runtime = 'nodejs';

const BodySchema = z.object({
  channel: z.enum(['linkedin', 'email']),
  format: z.enum(['connection_note', 'inmail']).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingProfile(id);
  if (!guard.ok) return guard.response;
  const { profile, campaign, user } = guard.value;

  const body = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'invalid_request', message: body.error.message }, { status: 400 });

  const email = profile.snapshot.contacts?.emails[0] ?? null;
  if (body.data.channel === 'email' && !email) {
    return NextResponse.json({ error: 'no_email', message: 'Ce profil n’affiche pas d’adresse attribuable à la personne.' }, { status: 409 });
  }

  try {
    const [prefs, recruiter, settings] = await Promise.all([
      getSourcingPreferences(user.id),
      getRecruiter(user.id).catch(() => null),
      getAppSettings().catch(() => null),
    ]);
    const format: MessageFormat = body.data.channel === 'email' ? 'email' : (body.data.format ?? prefs.messageFormat);
    const ctx = messageContextFrom(
      profile.snapshot,
      { jobTitle: fdpJobTitle(campaign.fdp), location: fdpText(campaign.fdp, 'location') },
      { displayName: recruiter?.displayName ?? null, organisation: resolveOrganizationName(settings) },
    );

    const { token, tokenHash } = mintApproachToken();
    const url = approachUrl(schedulingBaseUrl(), token);
    const composed = await composeApproachMessage(format, ctx, url);

    const approachId = await insertSourcingApproach({
      profile,
      recruiterId: user.id,
      channel: body.data.channel,
      messageFormat: format,
      message: composed.body, // avec `[lien]`, jamais l'URL
      tokenHash,
    });

    const text = renderMessage(composed.body, format, url);
    return NextResponse.json(
      {
        approachId,
        channel: body.data.channel,
        format,
        limit: MESSAGE_LIMITS[format],
        url,
        profileUrl: profile.snapshot.url,
        subject: composed.subject,
        message: text,
        draftedBy: composed.method,
        mailto: email ? mailtoHref(email, composed.subject, text) : null,
        email,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json({ error: 'approach_failed', message: (err as Error).message }, { status: 500 });
  }
}
