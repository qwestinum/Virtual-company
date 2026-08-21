/**
 * L'annonce « générique » d'une campagne — lecture, publication, dépublication.
 *
 * Surface RÉSERVÉE à l'instance de démonstration : sans `DEMO_JOBBOARD_ENABLED`,
 * les trois verbes rendent 404. Le panneau côté campagne s'appuie sur ce 404
 * pour ne pas s'afficher — le flag n'a donc jamais besoin de voyager jusqu'au
 * navigateur.
 *
 * PUT = PUBLIER, et publier veut dire FIGER : on enregistre le texte tel que
 * l'humain vient de le relire, sans repasser par le générateur. C'est le même
 * principe que le preview HITL des mails — ce qui a été validé part tel quel.
 * Le générateur vit dans la sous-route `generate`, et il n'écrit rien.
 */
import { NextResponse } from 'next/server';

import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  getJobPost,
  publishJobPost,
  unpublishJobPost,
} from '@/lib/db/repos/demo-job-posts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { isDemoJobboardEnabled } from '@/lib/jobboard/flag';
import { JobPostPublishSchema, fdpContract, fdpText } from '@/types/job-post';

export const runtime = 'nodejs';

const NOT_FOUND = NextResponse.json({ error: 'not_found' }, { status: 404 });

function unavailable(): NextResponse {
  // Volontairement un 404 et non un 403 : un 403 confirmerait l'existence de la
  // surface sur une instance où elle ne doit pas exister.
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

function serverError(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  return NextResponse.json(
    { error: 'job_post_failed', message: (err as Error).message },
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDemoJobboardEnabled()) return unavailable();
  const { id } = await context.params;
  try {
    return NextResponse.json({ post: await getJobPost(id) });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDemoJobboardEnabled()) return unavailable();
  const { id } = await context.params;

  let parsed;
  try {
    parsed = JobPostPublishSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Annonce invalide.',
      },
      { status: 400 },
    );
  }

  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NOT_FOUND;
    // Localisation et contrat sont FIGÉS ici avec le reste : une édition
    // ultérieure de la fiche de poste ne doit pas réécrire une annonce déjà
    // publiée sous les yeux d'un candidat.
    const post = await publishJobPost({
      campaignId: id,
      title: parsed.title,
      body: parsed.body,
      tags: parsed.tags,
      location: fdpText(campaign.fdp, 'location'),
      contract: fdpContract(campaign.fdp),
    });
    return NextResponse.json({ post });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDemoJobboardEnabled()) return unavailable();
  const { id } = await context.params;
  try {
    // Dépublier ne supprime pas : le texte relu reste disponible pour une
    // republication. Idempotent — rien à dépublier n'est pas une erreur.
    return NextResponse.json({ post: await unpublishJobPost(id) });
  } catch (err) {
    return serverError(err);
  }
}
