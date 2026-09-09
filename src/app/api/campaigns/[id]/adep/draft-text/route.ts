/**
 * Pré-rédaction du texte de l'offre APEC — le repli quand aucune annonce
 * générique n'existe.
 *
 * ── POURQUOI UNE ROUTE, ET PAS UN PRÉ-REMPLISSAGE À L'OUVERTURE ─────────────
 *
 * Parce que rédiger est un GESTE. Générer automatiquement à l'ouverture du
 * panneau écrirait à la place du recruteur sans qu'il l'ait demandé, et le
 * referait à chaque rechargement de l'écran — un appel au modèle par coup
 * d'œil. C'est la même séparation que le canal générique tient déjà entre
 * « rédiger » (ne persiste rien) et « publier » (fige le texte relu).
 *
 * ── CE QU'ELLE N'EST PAS ────────────────────────────────────────────────────
 *
 * Elle N'ÉCRIT RIEN. Ni `demo_job_posts`, ni `job_postings`, ni le snapshot de
 * campagne : elle rend un texte que le formulaire affiche, que le recruteur
 * relit, et que seul « Publier » envoie.
 *
 * Elle ne dépend PAS de `DEMO_JOBBOARD_ENABLED`, contrairement à la route
 * jumelle du jobboard : l'Apec est un canal réel, il n'a pas à s'éteindre avec
 * une démonstration commerciale. Le chemin de génération, lui, est le même
 * (`executeJobWriter`, canal générique) — deux rédacteurs pour un même poste
 * finiraient par écrire deux annonces différentes.
 */
import { NextResponse } from 'next/server';

import { withVivierRgpdMention } from '@/lib/agents/job-writer-render';
import { JobWriterError, executeJobWriter } from '@/lib/agents/server/job-writer-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getSenderEmail } from '@/lib/email/addresses';
import { prefillFromGeneration } from '@/lib/jobboards/adep/prefill';
import { JobAdResultSchema } from '@/types/job-writer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await getApiUser())) return unauthorizedResponse();
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
      taskId: `apec_${id}`,
      correlationId: `apec_${id}`,
      agentId: 'agent.job-writer',
      payload: { fdp: campaign.fdp, channel: 'generic' },
      context: { campaignId: id, priority: 'normal', requestedBy: 'agent.manager-rh' },
    });

    const ad = JobAdResultSchema.parse(output.data.ad);
    // Mention RGPD apposée de façon déterministe, comme sur l'autre chemin :
    // le contact est l'adresse de réception de la campagne, celle à laquelle un
    // candidat demandera la suppression de ses données.
    const settings = await getAppSettings().catch(() => null);
    const contact =
      (await resolveCampaignReceptionAddress(id, settings?.intakeEmail).catch(() => null)) ||
      (await getSenderEmail().catch(() => null)) ||
      '';
    const withMention = withVivierRgpdMention(ad, contact);

    return NextResponse.json({ prefill: prefillFromGeneration(withMention) });
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
    console.error('[api/campaigns/adep/draft-text] failed', err);
    return NextResponse.json(
      {
        error: 'generation_failed',
        message: err instanceof Error ? err.message : 'Pré-rédaction impossible.',
      },
      { status: 500 },
    );
  }
}
