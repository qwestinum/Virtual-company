/**
 * Re-mise en file d'une candidature en attente dont la fiche de validation
 * manque — « validation orpheline ».
 *
 * Une analyse en zone d'attente et sa ligne de file décrivent le même fait,
 * mais rien ne les relie en base : la seconde peut manquer sans que personne
 * ne s'en aperçoive (diagnostic du 20/09/2026,
 * `docs/ops/diagnostic-validations-orphelines-2026-09-20.md`). Le dossier porte
 * alors « À valider » et n'est pas décidable.
 *
 * ⚠️ Ce chemin N'ENVOIE RIEN, jamais. Mettre en file, c'est précisément le
 * contraire d'envoyer : la conformité RGPD du 18/08/2026 tient sur le fait
 * qu'aucun refus ne part sans un clic humain, et la file EST l'endroit où ce
 * clic est attendu. Garde structurelle : ce module n'importe aucun émetteur
 * (cf. le même invariant sur `decision-correction.ts`).
 */
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { enqueueValidationRow } from '@/lib/hitl/enqueue';
import {
  buildValidationFromAnalysis,
  type RequeueRefusal,
} from '@/lib/hitl/validation-from-analysis';

export type RequeueOutcome =
  | { kind: 'requeued'; validationId: string }
  /** La ligne existait déjà (ou est engagée) : rien à faire, et c'est un succès. */
  | { kind: 'already_queued'; validationId: string }
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: RequeueRefusal }
  | { kind: 'not_persisted' };

/**
 * Lit l'analyse, reconstruit la ligne, l'écrit par l'écrivain unique.
 * Idempotent : l'identifiant est déterministe et la fusion non destructive,
 * donc rejouer ne crée jamais un second dossier.
 *
 * `journalAction` distingue l'origine : une mise en file de RATTRAPAGE (dépôt
 * de CV par le chat, dont la file était orchestrée côté navigateur) n'est pas
 * une RÉPARATION demandée par un humain, et le journal ne doit pas les
 * confondre.
 */
export async function ensureValidationForAnalysis(
  analysisId: string,
  opts: {
    actor: { userId: string; email: string | null } | null;
    journalAction: string;
    journalActor: string;
  },
): Promise<RequeueOutcome> {
  const { actor } = opts;
  const analysis = await getCandidateAnalysis(analysisId);
  if (!analysis) return { kind: 'not_found' };

  // L'intitulé du poste ne vit pas dans l'analyse. Le nom de campagne SUIT le
  // champ `job_title` de la fiche (source de vérité unique), il en est donc la
  // meilleure image. Lecture fail-soft : un titre manquant dégrade la carte,
  // il ne doit pas empêcher de rendre un dossier décidable.
  const campaign = analysis.campaignId
    ? await getCampaign(analysis.campaignId).catch(() => null)
    : null;

  const built = buildValidationFromAnalysis(analysis, campaign?.name ?? null);
  if (!built.ok) return { kind: 'refused', reason: built.reason };

  const outcome = await enqueueValidationRow(built.validation);
  if (outcome === 'failed') return { kind: 'not_persisted' };
  if (outcome === 'already_engaged') {
    return { kind: 'already_queued', validationId: built.validation.id };
  }

  await appendJournalEntry({
    action: opts.journalAction,
    actor: actor?.email ?? opts.journalActor,
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      validationId: built.validation.id,
      candidate: analysis.candidateName,
      decisionZone: analysis.decisionZone,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  }).catch(() => {});

  return { kind: 'requeued', validationId: built.validation.id };
}

/** Réparation DEMANDÉE par un humain, depuis la fiche candidature. */
export function requeueValidationForAnalysis(
  analysisId: string,
  actor: { userId: string; email: string | null } | null,
): Promise<RequeueOutcome> {
  return ensureValidationForAnalysis(analysisId, {
    actor,
    journalAction: 'validation_requeued',
    journalActor: 'user',
  });
}

/**
 * Filet SERVEUR du dépôt de CV par le chat : la mise en file y était
 * orchestrée par le navigateur (`dispatchPostAnalysisOutreach`, en
 * fire-and-forget), donc un onglet fermé perdait le dossier. Le chemin IMAP,
 * lui, a toujours écrit côté serveur. Les deux portes ont désormais la même
 * garantie — et la fusion non destructive laisse le client enrichir ensuite
 * (rapport d'analyse du lot, intitulé du poste).
 */
export function ensureValidationAfterChatAnalysis(
  analysisId: string,
): Promise<RequeueOutcome> {
  return ensureValidationForAnalysis(analysisId, {
    actor: null,
    journalAction: 'chat_outreach_pending',
    journalActor: 'cv_analyzer',
  });
}
