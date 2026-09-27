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
import {
  checkValidationCoherence,
  type AnalysisFacts,
  type ValidationCoherence,
} from '@/lib/hitl/queue-coherence';
import { validationIdFor } from '@/lib/hitl/validation-id';
import { prepareReferentContext } from '@/lib/referent/context';
import {
  HitlDecisionSchema,
  type DecisionZone,
  type PendingValidation,
} from '@/types/hitl';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  // ?status=sent → historique consultable (lot 2d) ; défaut = file en attente.
  const status = new URL(request.url).searchParams.get('status');
  // Recruteurs et session ne dépendent pas de la file : lus dès maintenant.
  const referentContextFor = prepareReferentContext();
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
    // COHÉRENCE file ↔ analyse, servie AVEC la file. Le sens inverse de
    // `validations_orphelines` : une ligne OUVERTE dont l'analyse n'attend
    // plus. Deux dossiers de production portaient ainsi la direction `reject`
    // sur une analyse `auto_accept` — refuser depuis cette carte aurait envoyé
    // un refus à quelqu'un que le reste du produit compte comme accepté.
    // Jugée par un prédicat PUR et partagé, jamais recalculée à l'écran.
    const coherenceByValidation: Record<string, ValidationCoherence> = {};
    const uidOf = (v: PendingValidation): string | null =>
      typeof v.payload?.uid === 'string' ? v.payload.uid : null;
    const uids = [
      ...new Set(validations.map(uidOf).filter((u): u is string => u !== null)),
    ];
    // Référent de CHAQUE campagne présente dans la file, en UNE passe pour
    // toute la page (deux requêtes), jamais une par carte. Lancé en même temps
    // que les zones : les deux ne dépendent que de la file.
    const referentPromise = referentContextFor(validations.map((v) => v.campaignId));
    if (uids.length > 0) {
      const factsByUid = new Map<string, NonNullable<AnalysisFacts>>();
      const parts = await Promise.all(
        chunk(uids, 300).map((part) => listAllCandidateAnalyses({ uidIn: part })),
      );
      for (const rows of parts) {
        for (const row of rows) {
          factsByUid.set(row.uid, {
            decisionZone: row.decisionZone,
            decidedBy: row.decidedBy,
            dismissedAt: row.dismissedAt,
          });
        }
      }
      for (const v of validations) {
        const uid = uidOf(v);
        const facts = uid ? (factsByUid.get(uid) ?? null) : null;
        zoneByValidation[v.id] = facts?.decisionZone ?? null;
        coherenceByValidation[v.id] = checkValidationCoherence(facts);
      }
    }
    const { referentByCampaign, currentUserId } = await referentPromise;
    return NextResponse.json({
      validations,
      zoneByValidation,
      coherenceByValidation,
      referentByCampaign,
      currentUserId,
    });
  } catch (err) {
    console.error('[api/validations] GET failed', err);
    return NextResponse.json({
      validations: [],
      zoneByValidation: {},
      coherenceByValidation: {},
    });
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

  // IDENTIFIANT CANONIQUE, dérivé du dossier — l'id envoyé par l'appelant n'est
  // qu'un repli. C'est le dernier chemin par lequel DEUX fiches pouvaient
  // coexister pour une seule candidature : chaque appelant calculait sa propre
  // chaîne, et le chemin chat en tirait une ALÉATOIRE. Deux fiches pour un
  // dossier, c'est le même candidat proposé deux fois au recruteur, et une
  // décision qui n'en ferme qu'une.
  const analysisKey =
    typeof parsed.payload.analysisId === 'string' && parsed.payload.analysisId
      ? parsed.payload.analysisId
      : parsed.payload.uid;
  const canonicalId = validationIdFor(analysisKey, parsed.decision);

  const now = new Date().toISOString();
  const validation: PendingValidation = {
    id: canonicalId,
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
    // `null` : la fiche s'est engagée entre la lecture et l'écriture (une
    // réservation d'envoi). On rend l'état RÉEL, jamais celui qu'on voulait
    // écrire.
    const saved = await upsertPendingValidation(merged.value);
    return NextResponse.json({
      validation: saved ?? (await getPendingValidation(validation.id)),
    });
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
