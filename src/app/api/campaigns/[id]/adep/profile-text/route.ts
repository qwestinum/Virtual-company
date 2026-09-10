/**
 * Rédaction du « profil recherché » de l'offre APEC.
 *
 * ── POURQUOI CETTE ROUTE EST APPELÉE À L'OUVERTURE ──────────────────────────
 *
 * Contrairement à `draft-text` (le texte complet de l'offre, derrière un
 * bouton), le profil est demandé dès l'ouverture du panneau : le recruteur
 * trouve le champ rempli et l'ajuste avant de publier, comme il le fait déjà du
 * descriptif repris de l'annonce. Décision du donneur d'ordre — un champ vide
 * ou une liste de compétences ne dressent aucun profil, et l'écran doit
 * présenter une offre présentable.
 *
 * Le coût est borné côté client : UN appel par ouverture de panneau, jamais
 * sur un rechargement d'état (`reload`), et jamais quand l'offre est déjà
 * publiée — le formulaire n'est alors même pas affiché.
 *
 * ── ELLE N'ÉCRIT RIEN ───────────────────────────────────────────────────────
 *
 * Ni `job_postings`, ni le snapshot de campagne : elle rend un texte que le
 * formulaire affiche, que le recruteur relit et corrige, et que seul
 * « Publier » envoie chez l'Apec.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { writeApecProfile } from '@/lib/agents/server/apec-profile-write';
import { AIProviderError, AIValidationError } from '@/lib/ai/errors';
import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { FDPInProgress, FieldKey } from '@/types/field-collection';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Le descriptif VU À L'ÉCRAN, quand il y en a un : c'est la source la plus
 * juste (il peut venir d'une annonce relue, d'une pré-rédaction ou de la main
 * du recruteur). Optionnel — sans lui, on retombe sur la fiche de poste.
 */
const BodySchema = z.object({
  positionDescription: z.string().max(5_000).optional(),
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
  // Repli sur les missions de la fiche : le profil se rédige à partir de ce que
  // le poste demande, et sans descriptif à l'écran c'est là que ça vit.
  const description =
    body.positionDescription?.trim() || list(fdp, 'main_missions').join('. ');

  try {
    const profileDescription = await writeApecProfile({
      jobTitle: text(fdp, 'job_title'),
      positionDescription: description,
      seniority: text(fdp, 'seniority'),
      keySkills: list(fdp, 'key_skills'),
      contractType: contractText(fdp),
    });
    return NextResponse.json({ profileDescription });
  } catch (err) {
    // Un profil non rédigé n'est PAS un échec du panneau : l'écran garde le
    // report des compétences clés et dit que la rédaction n'a pas abouti.
    if (err instanceof AIValidationError) {
      return NextResponse.json(
        {
          error: 'profile_unavailable',
          message: 'Le modèle n’a pas rendu un profil exploitable.',
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
    console.error('[api/campaigns/adep/profile-text] failed', err);
    return NextResponse.json(
      {
        error: 'profile_failed',
        message: err instanceof Error ? err.message : 'Rédaction du profil impossible.',
      },
      { status: 500 },
    );
  }
}
