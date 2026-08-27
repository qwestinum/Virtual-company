/**
 * /api/validations — file des validations suspendues (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * GET  : liste les validations en attente (status = 'pending').
 * POST : crée une validation suspendue (appelé par le gating quand une section
 *        HITL est activée — le mail est rédigé en brouillon, l'envoi différé).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { chunk } from '@/lib/db/paginate';
import {
  getPendingValidation,
  listPendingValidations,
  listSentValidations,
  upsertPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { mergePendingValidationEnqueue } from '@/lib/hitl/enqueue-merge';
import { loadReferentContext } from '@/lib/referent/context';
import {
  HitlDecisionSchema,
  type DecisionZone,
  type PendingValidation,
} from '@/types/hitl';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  // ?status=sent → historique consultable (lot 2d) ; défaut = file en attente.
  const status = new URL(request.url).searchParams.get('status');
  try {
    const validations =
      status === 'sent'
        ? await listSentValidations()
        : await listPendingValidations();
    // ZONE FIGÉE AU SCORING de chaque validation, servie AVEC la file : c'est
    // ELLE qui borne le sous-onglet « Propositions de refus », jamais une
    // comparaison du score au seuil COURANT de la campagne.
    //
    // Les seuils d'une campagne se déplacent ; la zone d'un dossier déjà
    // analysé, non. Recomparer au seuil du jour ferait basculer dans les
    // propositions de refus une candidature analysée en zone grise — défaut
    // observé en recette : re-juger un dossier avec un barème qu'il n'a jamais
    // connu. La colonne `decision_zone` est la seule vérité.
    //
    // Rapprochement par `payload.uid` (même clé que le menu Candidatures et le
    // Bureau), chunké pour rester sous le cap PostgREST quel que soit le volume.
    // Forme : { [validationId]: DecisionZone | null }. Absent = « à examiner ».
    const zoneByValidation: Record<string, DecisionZone | null> = {};
    const uidOf = (v: PendingValidation): string | null =>
      typeof v.payload?.uid === 'string' ? v.payload.uid : null;
    const uids = [
      ...new Set(validations.map(uidOf).filter((u): u is string => u !== null)),
    ];
    if (uids.length > 0) {
      const zoneByUid = new Map<string, DecisionZone | null>();
      for (const part of chunk(uids, 300)) {
        const rows = await listAllCandidateAnalyses({ uidIn: part });
        for (const row of rows) zoneByUid.set(row.uid, row.decisionZone);
      }
      for (const v of validations) {
        const uid = uidOf(v);
        zoneByValidation[v.id] = uid ? (zoneByUid.get(uid) ?? null) : null;
      }
    }
    // Référent de CHAQUE campagne présente dans la file, en UNE passe pour
    // toute la page (deux requêtes), jamais une par carte.
    const { referentByCampaign, currentUserId } = await loadReferentContext(
      validations.map((v) => v.campaignId),
    );
    return NextResponse.json({
      validations,
      zoneByValidation,
      referentByCampaign,
      currentUserId,
    });
  } catch (err) {
    console.error('[api/validations] GET failed', err);
    return NextResponse.json({ validations: [], zoneByValidation: {} });
  }
}

const CreateSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  candidateName: z.string().min(1),
  candidateEmail: z.string().nullable(),
  score: z.number().int().nullable(),
  decision: HitlDecisionSchema,
  cvArtifactId: z.string().nullable().optional(),
  reportArtifactId: z.string().nullable().optional(),
  mailDraftArtifactId: z.string().nullable().optional(),
  // L2 : `uid` (de l'analyse) OBLIGATOIRE dans le payload — c'est la clé de
  // rapprochement métrique (exclusion + override d'issue). Le reste passe libre.
  payload: z.object({ uid: z.string().min(1) }).passthrough(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof CreateSchema>;
  try {
    parsed = CreateSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const validation: PendingValidation = {
    id: parsed.id,
    campaignId: parsed.campaignId,
    candidateName: parsed.candidateName,
    candidateEmail: parsed.candidateEmail,
    score: parsed.score,
    decision: parsed.decision,
    cvArtifactId: parsed.cvArtifactId ?? null,
    reportArtifactId: parsed.reportArtifactId ?? null,
    mailDraftArtifactId: parsed.mailDraftArtifactId ?? null,
    confirmed: false,
    status: 'pending',
    payload: parsed.payload,
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
    // Personne n'a encore confirmé à l'enqueue (la confirmation humaine
    // posera decidedBy='user' + identité, côté serveur).
    decidedBy: null,
    decidedByUser: null,
  };

  try {
    // Enqueue NON DESTRUCTIF (cf. mergePendingValidationEnqueue) : un retry
    // client sur le même id ne remplace jamais un lien d'artefact non-null
    // par null et ne ré-ouvre jamais une validation déjà engagée/tranchée.
    const existing = await getPendingValidation(validation.id);
    const merged = mergePendingValidationEnqueue(existing, validation);
    if (!merged.write) {
      return NextResponse.json({ validation: existing });
    }
    const saved = await upsertPendingValidation(merged.value);
    return NextResponse.json({ validation: saved });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
