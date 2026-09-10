/**
 * Rédaction des deux textes de l'offre APEC — descriptif du poste et profil
 * recherché, en un seul appel (le profil doit correspondre au descriptif).
 *
 * ── POURQUOI CETTE ROUTE EST APPELÉE À L'OUVERTURE ──────────────────────────
 *
 * Le recruteur trouve les champs rédigés et les ajuste avant de publier.
 * Décision du donneur d'ordre : un report de listes (« Missions principales :
 * - … ») ne fait ni un descriptif ni un profil, et l'écran doit présenter une
 * offre présentable sans qu'on ait à demander un geste de plus.
 *
 * Le coût est borné côté client : UN appel par ouverture de panneau, et jamais
 * quand l'offre est déjà partie chez l'Apec — le formulaire n'est alors même
 * pas affiché.
 *
 * ⚠️ Un texte REPRIS d'une annonce générique relue par un humain n'est jamais
 * réécrit automatiquement : le client n'applique le descriptif rédigé que
 * lorsque le champ ne portait qu'un report de la fiche. Réécrire un texte
 * validé demande un geste (« Rédiger à nouveau »).
 *
 * ── ELLE N'ÉCRIT RIEN ───────────────────────────────────────────────────────
 *
 * Ni `job_postings`, ni le snapshot de campagne : elle rend des textes que le
 * formulaire affiche, que le recruteur relit et corrige, et que seul
 * « Publier » envoie chez l'Apec.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { writeApecOfferText } from '@/lib/agents/server/apec-offer-text-write';
import { resolveCampaignReceptionAddress } from '@/lib/campaign/reception-address';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getSenderEmail } from '@/lib/email/addresses';
import {
  buildVivierRgpdMention,
  stripVivierRgpdMention,
  withRgpdMentionAppended,
} from '@/lib/vivier/rgpd-mention';
import { AIProviderError, AIValidationError } from '@/lib/ai/errors';
import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Le descriptif VU À L'ÉCRAN, quand il y en a un : c'est le matériau le plus
 * juste (il peut venir d'une annonce relue, d'un brouillon ou de la main du
 * recruteur). Optionnel — sans lui, on retombe sur les missions de la fiche.
 */
const BodySchema = z.object({
  positionDescription: z.string().max(8_000).optional(),
});

function text(fdp: FDPInProgress, key: FieldKey): string {
  const value = fdp.fields[key]?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function list(fdp: FDPInProgress, key: FieldKey): string[] {
  const value = fdp.fields[key]?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Le contrat peut être une chaîne ou une liste selon la saisie de la fiche. */
function contractText(fdp: FDPInProgress): string {
  const value = fdp.fields.contract_type?.value;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').join(', ');
  }
  return '';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await getApiUser())) return unauthorizedResponse();
  const { id } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Requête invalide.',
      },
      { status: 400 },
    );
  }

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

  const fdp = campaign.fdp;
  // Repli sur les missions de la fiche : les textes se rédigent à partir de ce
  // que le poste demande, et sans descriptif à l'écran c'est là que ça vit.
  // ⚠️ La mention RGPD est RETIRÉE du matériau : un descriptif qui la porte
  // déjà repartirait sinon la faire reformuler au modèle, avant qu'on la
  // rajoute — deux mentions dans une même offre.
  const sourceText = stripVivierRgpdMention(
    body.positionDescription?.trim() || list(fdp, 'main_missions').join('. '),
  );

  // Contact de la mention : l'adresse à laquelle un candidat demandera la
  // suppression de ses données. Même cascade que la pré-rédaction d'annonce.
  const settings = await getAppSettings().catch(() => null);
  const contact =
    (await resolveCampaignReceptionAddress(id, settings?.intakeEmail).catch(
      () => null,
    )) ||
    (await getSenderEmail().catch(() => null)) ||
    '';

  try {
    const texts = await writeApecOfferText(
      {
        jobTitle: text(fdp, 'job_title'),
        sourceText,
        seniority: text(fdp, 'seniority'),
        keySkills: list(fdp, 'key_skills'),
        contractType: contractText(fdp),
      },
      // Place réservée à la mention, pour que le descriptif rendu tienne dans
      // la borne de l'Apec une fois celle-ci apposée.
      buildVivierRgpdMention(contact).length + 2,
    );
    return NextResponse.json({
      // Mention apposée de façon DÉTERMINISTE, comme sur l'autre chemin de
      // rédaction : jamais laissée au modèle, qui pourrait l'oublier ou en
      // inventer une autre.
      positionDescription: withRgpdMentionAppended(
        texts.positionDescription,
        contact,
      ),
      profileDescription: texts.profileDescription,
    });
  } catch (err) {
    // Des textes non rédigés ne sont PAS un échec du panneau : l'écran garde le
    // report des listes de la fiche et dit que la rédaction n'a pas abouti.
    if (err instanceof AIValidationError) {
      return NextResponse.json(
        {
          error: 'offer_text_unavailable',
          message: 'Le modèle n’a pas rendu des textes exploitables.',
        },
        { status: 502 },
      );
    }
    if (err instanceof AIProviderError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.code === 'config_missing' ? 500 : 502 },
      );
    }
    console.error('[api/campaigns/adep/offer-text] failed', err);
    return NextResponse.json(
      {
        error: 'offer_text_failed',
        message: err instanceof Error ? err.message : 'Rédaction des textes impossible.',
      },
      { status: 500 },
    );
  }
}
