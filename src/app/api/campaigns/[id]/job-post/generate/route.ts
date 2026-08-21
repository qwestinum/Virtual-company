/**
 * Pré-rédaction de l'annonce générique d'une campagne.
 *
 * N'ÉCRIT RIEN. La génération produit un brouillon que le recruteur relit et
 * ajuste ; seule la publication (PUT `../job-post`) enregistre quoi que ce
 * soit. Séparer les deux est ce qui garantit qu'une annonce publiée ne peut pas
 * être réécrite par un appel au générateur.
 *
 * Réutilise `executeJobWriter` en direct plutôt que de faire un aller-retour
 * HTTP vers `/api/job-writer` : même agent, même prompt, une requête de moins.
 * La mention RGPD est apposée de façon déterministe, comme sur l'autre chemin.
 */
import { NextResponse } from 'next/server';

import { withVivierRgpdMention } from '@/lib/agents/job-writer-render';
import {
  JobWriterError,
  executeJobWriter,
} from '@/lib/agents/server/job-writer-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getSenderEmail } from '@/lib/email/addresses';
import { isDemoJobboardEnabled } from '@/lib/jobboard/flag';
import { JobAdResultSchema } from '@/types/job-writer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isDemoJobboardEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { id } = await context.params;

  let campaign;
  try {
    campaign = await getCampaign(id);
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    throw err;
  }
  if (!campaign) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const output = await executeJobWriter({
      taskId: `jobpost_${id}`,
      correlationId: `jobpost_${id}`,
      agentId: 'agent.job-writer',
      payload: { fdp: campaign.fdp, channel: 'generic' },
      context: {
        campaignId: id,
        priority: 'normal',
        requestedBy: 'agent.manager-rh',
      },
    });

    const ad = JobAdResultSchema.parse(output.data.ad);
    // Contact de la mention RGPD = l'adresse de réception de la campagne, celle
    // à laquelle le candidat pourra demander la suppression de ses données.
    const settings = await getAppSettings().catch(() => null);
    const contact =
      (await resolveCampaignReceptionAddress(id, settings?.intakeEmail).catch(
        () => null,
      )) ||
      (await getSenderEmail().catch(() => null)) ||
      '';
    return NextResponse.json({ draft: withVivierRgpdMention(ad, contact) });
  } catch (err) {
    if (err instanceof JobWriterError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === 'invalid_payload' ? 400 : 502 },
      );
    }
    if (err instanceof AIProviderError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === 'config_missing' ? 500 : 502 },
      );
    }
    return NextResponse.json(
      {
        error: 'generation_failed',
        message: err instanceof Error ? err.message : 'Génération impossible.',
      },
      { status: 500 },
    );
  }
}
