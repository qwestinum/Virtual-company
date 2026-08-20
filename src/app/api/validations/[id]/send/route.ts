/**
 * /api/validations/[id]/send — finalise une validation (HITL, P5).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Appelé par le client APRÈS l'envoi effectif du mail (mail-composer override
 * + scheduler pour un accept). Rôle : marquer la validation `sent` + journaliser
 * la décision (pour que les métriques la comptabilisent — P7). Idempotent.
 */
import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import { updateCandidateAnalysisDecision } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  getPendingValidation,
  patchPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { analysisIdForValidation } from '@/lib/hitl/analysis-key';
import { revokeCampaignBookingLink } from '@/lib/scheduling-host/campaign-booking';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  // Message-id Resend + STATUT D'ENVOI réel (audit C6, journal honnête) —
  // propagés par le client. Corps tolérant au vide : un POST sans corps
  // (rétro-compat) reste valide, mailStatus retombe sur 'unknown'.
  let providerMessageId: string | null = null;
  let mailStatus = 'unknown';
  // Refus groupé — identifiant du LOT qui a produit cette décision (optionnel).
  // Sert à retrouver « les 40 refus de mardi » d'un seul geste dans le journal ;
  // il ne change RIEN au traitement, chaque validation restant décidée une par
  // une avec sa propre réservation et son propre claim.
  let batchId: string | null = null;
  try {
    const body = (await request.json()) as {
      providerMessageId?: unknown;
      mailStatus?: unknown;
      batchId?: unknown;
    };
    if (typeof body?.providerMessageId === 'string') {
      providerMessageId = body.providerMessageId;
    }
    if (typeof body?.mailStatus === 'string' && body.mailStatus.trim() !== '') {
      mailStatus = body.mailStatus;
    }
    if (typeof body?.batchId === 'string' && body.batchId.trim() !== '') {
      batchId = body.batchId;
    }
  } catch {
    // pas de corps / JSON invalide → on ignore, valeurs par défaut.
  }
  // Le mail est réputé parti si l'envoi a réussi MAINTENANT ('sent') ou lors
  // d'une tentative précédente ('duplicate' = claim confirmé, prouvé).
  const mailWentOut = mailStatus === 'sent' || mailStatus === 'duplicate';
  // DEUX VÉRITÉS D'AUDIT DISTINCTES sous un mail non parti :
  //   - `skipped_by_user` : personne n'a essayé, c'est un CHOIX (case décochée
  //     au refus groupé). Le candidat est à contacter autrement, ou pas.
  //   - tout le reste : on a essayé et ÉCHOUÉ. C'est un incident, il appelle
  //     une reprise.
  // Les confondre ferait lire une panne là où il y a une décision, et
  // inversement — d'où le champ explicite plutôt qu'une déduction du statut
  // par chaque lecteur.
  const skippedByUser = mailStatus === 'skipped_by_user';
  try {
    const validation = await getPendingValidation(id);
    if (!validation) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (validation.status === 'sent') {
      return NextResponse.json({ validation }); // idempotent
    }

    // Journalise la décision tranchée → comptabilisée au dashboard (P7).
    // JOURNAL HONNÊTE (audit C6) : le nom d'action est conservé (les lecteurs
    // de métriques comptent les DÉCISIONS dessus), mais `mailStatus` dit la
    // vérité sur l'ENVOI — la décision humaine vaut même si Resend est en
    // panne, le journal ne doit juste pas prétendre qu'un mail est parti.
    await appendJournalEntry({
      action: 'hitl_validation_sent',
      campaignId: validation.campaignId,
      actor: 'user',
      payload: {
        // UID de l'analyse → rattache au candidat EXACT (chaque analyse est un
        // traitement distinct, pas de fusion par email).
        uid:
          typeof validation.payload?.uid === 'string'
            ? validation.payload.uid
            : null,
        decision: validation.decision,
        candidateName: validation.candidateName,
        candidateEmail: validation.candidateEmail,
        score: validation.score,
        // Statut d'envoi RÉEL ('sent' | 'duplicate' = déjà parti | 'send_failed'
        // | 'skipped_no_email' | 'skipped_no_config' | 'network_error' | 'unknown').
        mailStatus,
        mailSent: mailWentOut,
        mailSkippedByUser: skippedByUser,
        batchId,
        // Livraison vérifiable via GET /api/email/status?id=… (null si l'envoi
        // a échoué/été sauté — la décision reste enregistrée).
        providerMessageId,
      },
    });

    // Action DÉDIÉE quand le mail n'est PAS parti : rend requêtable en une
    // passe la liste des « décidés mais jamais contactés » (à recontacter).
    if (!mailWentOut) {
      await appendJournalEntry({
        action: 'hitl_mail_not_sent',
        campaignId: validation.campaignId,
        actor: 'user',
        payload: {
          validationId: id,
          uid:
            typeof validation.payload?.uid === 'string'
              ? validation.payload.uid
              : null,
          decision: validation.decision,
          candidateName: validation.candidateName,
          candidateEmail: validation.candidateEmail,
          mailStatus,
          batchId,
          // Champ de tri de l'audit — cf. commentaire de `skippedByUser`.
          cause: skippedByUser ? 'skipped_by_user' : 'send_failed',
          reason: skippedByUser
            ? 'décision humaine enregistrée, envoi du mail volontairement sauté — candidat NON contacté'
            : 'décision humaine enregistrée mais mail candidat NON parti — à recontacter manuellement',
        },
      }).catch((jErr) =>
        console.error('[validations/send] journal hitl_mail_not_sent KO', jErr),
      );
    }

    const updated = await patchPendingValidation(id, {
      status: 'sent',
      decidedAt: new Date().toISOString(),
    });

    // REFUS tranché : le lien de réservation éventuellement émis pendant la
    // relecture meurt ici. Le cas n'est pas théorique — le DRH ouvre souvent
    // le brouillon d'acceptation (qui ÉMET le lien) avant de changer d'avis.
    // Serveur, pas client : c'est ici qu'on a la décision, l'identité de la
    // campagne et la clé. Best-effort : un lien encore vivant ne doit pas
    // faire échouer l'enregistrement d'une décision déjà prise.
    if (validation.decision === 'reject') {
      const analysisId = analysisIdForValidation(validation);
      if (analysisId) {
        await revokeCampaignBookingLink(
          validation.campaignId,
          analysisId,
          'candidature refusée',
        ).catch((err) =>
          console.error('[validations/send] révocation du lien KO', err),
        );
      }
    }

    // Propagation lot 2 — un humain a tranché un gris : on fige le statut FINAL
    // de l'analyse + son identité (depuis la SESSION serveur, jamais le client).
    // `decision_zone` reste 'gray' (audit « repêché par l'humain »). Best-effort.
    const uid =
      typeof validation.payload?.uid === 'string' ? validation.payload.uid : null;
    if (uid) {
      const user = await getApiUser();
      await updateCandidateAnalysisDecision({
        uid,
        campaignId: validation.campaignId,
        status: validation.decision === 'accept' ? 'accepted' : 'rejected',
        decidedByUser: user ? { userId: user.id, email: user.email ?? null } : null,
      });
    }
    return NextResponse.json({ validation: updated ?? validation });
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
