'use client';

/**
 * Helpers d'actions DRH sur un candidat (Session 6 v2).
 *
 * Le pointage d'entretien POST le journal Supabase ; le verdict final passe
 * par sa route dédiée, avec son commentaire facultatif. Chacun déclenche une prise
 * d'acte du Manager dans le chat. La résolution finale du KPI dépend du
 * derive-metrics qui regarde la dernière action wins.
 *
 * Pas de mutation locale du store candidats — la prochaine requête de
 * polling du dashboard re-dérivera tout depuis le journal.
 */

import { buildInterviewMarkerEntry } from '@/lib/candidatures/decision-markers';
import { useChatStore } from '@/stores/chat-store';
import type { FeedbackChoice, FeedbackMailStatus } from '@/types/candidate-feedback';
import type { FinalVerdict } from '@/types/verdict-comment';

/**
 * Valeur offerte par les boutons NORMAUX : le seul CONSTAT. La gomme
 * `cleared` n'est posée que par le flux de correction ; l'absence (`missed`)
 * est une DÉCISION qui a sa route (`/api/candidatures/[id]/no-show`, message
 * au candidat obligatoire) — `/api/journal` la refuse.
 */
export type InterviewMark = 'realized';

export async function markCandidateInterview(args: {
  uid: string;
  candidateName: string;
  campaignId: string | null;
  status: InterviewMark;
}): Promise<void> {
  await postJournal(
    buildInterviewMarkerEntry({
      uid: args.uid,
      candidateName: args.candidateName,
      campaignId: args.campaignId,
      value: args.status,
    }),
  );
  pushChatLine(
    `J'ai noté que l'entretien avec ${args.candidateName} a eu lieu. Je l'ajoute au compteur entretiens.`,
  );
}

/**
 * Verdict final, avec son commentaire FACULTATIF. Passe par la route dédiée
 * (le journal générique refuse ce marqueur). Contrairement aux
 * marquages best-effort ci-dessus, l'issue est RENDUE : un verdict refusé
 * doit rester à l'écran avec sa raison, jamais disparaître en silence.
 */
export type VerdictPostResult =
  | {
      ok: true;
      /** Phrase d'issue du message au candidat, à AFFICHER (jamais tue). */
      feedbackNotice: string;
      /** Le message devait partir et n'est pas parti : l'écran le signale. */
      feedbackFailed: boolean;
    }
  | {
      ok: false;
      message: string;
      /** L'état a bougé ailleurs (409) : l'écran doit se recharger. */
      reload: boolean;
    };

export async function postCandidateVerdict(args: {
  analysisId: string;
  candidateName: string;
  status: FinalVerdict;
  comment: string;
  feedback: FeedbackChoice;
}): Promise<VerdictPostResult> {
  let res: Response;
  try {
    res = await fetch(`/api/candidatures/${encodeURIComponent(args.analysisId)}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: args.status,
        comment: args.comment,
        feedback: args.feedback,
      }),
    });
  } catch {
    return {
      ok: false,
      message: 'Le verdict n’a pas pu être enregistré (réseau). Votre commentaire est conservé : réessayez.',
      reload: false,
    };
  }
  const data = (await res.json().catch(() => ({}))) as DecisionResponse;
  if (res.ok) {
    const noted = args.comment.trim() !== '' ? ' Votre commentaire est au dossier.' : '';
    pushChatLine(
      args.status === 'validated'
        ? `${args.candidateName} est retenu.${noted}`
        : `${args.candidateName} n'est pas retenu sur cette campagne.${noted}`,
    );
    return { ok: true, ...describeFeedbackOutcome(data.feedback) };
  }
  if (res.status === 409) {
    return {
      ok: false,
      message: 'Ce dossier n’attend plus de verdict (décidé ou modifié entre-temps). L’écran se met à jour.',
      reload: true,
    };
  }
  return {
    ok: false,
    message: data.message ?? 'Le verdict n’a pas pu être enregistré. Votre commentaire est conservé : réessayez.',
    reload: false,
  };
}

type DecisionResponse = {
  error?: string;
  message?: string;
  feedback?:
    | { channel: string; mailStatus: FeedbackMailStatus | null }
    | { error: 'record_failed' };
};

/**
 * Ce que l'écran dit du message au candidat APRÈS la décision. Une décision
 * posée dont le message n'est pas parti se DIT : la fiche propose ensuite
 * « Informer le candidat ».
 */
export function describeFeedbackOutcome(
  feedback: DecisionResponse['feedback'],
): { feedbackNotice: string; feedbackFailed: boolean } {
  if (!feedback || 'error' in feedback) {
    return {
      feedbackNotice:
        'Décision enregistrée, mais le message au candidat n’a pas pu être enregistré. Informez-le depuis sa fiche.',
      feedbackFailed: true,
    };
  }
  if (feedback.channel !== 'mail') {
    return { feedbackNotice: 'Vous prévenez le candidat vous-même ; c’est noté au dossier.', feedbackFailed: false };
  }
  switch (feedback.mailStatus) {
    case 'sent':
      return { feedbackNotice: 'Le message est parti au candidat.', feedbackFailed: false };
    case 'duplicate':
      return { feedbackNotice: 'Ce message était déjà parti : rien n’a été renvoyé.', feedbackFailed: false };
    default:
      return {
        feedbackNotice:
          'Décision enregistrée, mais le message n’est pas parti. Réessayez depuis la fiche du candidat.',
        feedbackFailed: true,
      };
  }
}

/** Décision qui informe le candidat (absence, sans suite) — même contrat de retour. */
export async function postDecisionWithFeedback(
  url: string,
  body: Record<string, unknown>,
): Promise<VerdictPostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'La décision n’a pas pu être enregistrée (réseau). Réessayez.', reload: false };
  }
  const data = (await res.json().catch(() => ({}))) as DecisionResponse;
  if (res.ok) return { ok: true, ...describeFeedbackOutcome(data.feedback) };
  if (res.status === 409) {
    return {
      ok: false,
      message:
        data.error === 'send_in_flight'
          ? 'Un envoi est en cours pour ce candidat — réessayez dans quelques minutes.'
          : 'Ce dossier a changé entre-temps. L’écran se met à jour.',
      reload: data.error !== 'send_in_flight',
    };
  }
  return { ok: false, message: data.message ?? `La décision a échoué (HTTP ${res.status}).`, reload: false };
}

function pushChatLine(content: string): void {
  useChatStore.getState().appendMessage({
    role: 'manager',
    source: 'text',
    content,
  });
}

async function postJournal(entry: {
  action: string;
  campaignId: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: entry.action,
        campaignId: entry.campaignId,
        actor: 'user',
        payload: entry.payload,
      }),
    });
  } catch {
    // best-effort : le poll suivant ne verra pas l'action mais l'ack chat reste.
  }
}
