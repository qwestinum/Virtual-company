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
import type { FinalVerdict } from '@/types/verdict-comment';

/**
 * Valeurs offertes par les boutons NORMAUX. La gomme `cleared` existe dans le
 * vocabulaire (`decision-markers`) mais n'est posée QUE par le flux de
 * correction : « annuler un marquage » n'est pas une action de pipeline.
 */
export type InterviewMark = 'realized' | 'missed';

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
    args.status === 'realized'
      ? `J'ai noté que l'entretien avec ${args.candidateName} a eu lieu. Je l'ajoute au compteur entretiens.`
      : `J'ai noté que l'entretien avec ${args.candidateName} n'a pas eu lieu. Je le sors du compteur entretiens.`,
  );
}

/**
 * Verdict final, avec son commentaire FACULTATIF. Passe par la route dédiée
 * (le journal générique refuse ce marqueur). Contrairement aux
 * marquages best-effort ci-dessus, l'issue est RENDUE : un verdict refusé
 * doit rester à l'écran avec sa raison, jamais disparaître en silence.
 */
export type VerdictPostResult =
  | { ok: true }
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
}): Promise<VerdictPostResult> {
  let res: Response;
  try {
    res = await fetch(`/api/candidatures/${encodeURIComponent(args.analysisId)}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: args.status, comment: args.comment }),
    });
  } catch {
    return {
      ok: false,
      message: 'Le verdict n’a pas pu être enregistré (réseau). Votre commentaire est conservé : réessayez.',
      reload: false,
    };
  }
  if (res.ok) {
    const noted = args.comment.trim() !== '' ? ' Votre commentaire est au dossier.' : '';
    pushChatLine(
      args.status === 'validated'
        ? `${args.candidateName} est validé définitivement.${noted}`
        : `${args.candidateName} n'est pas retenu sur cette campagne.${noted}`,
    );
    return { ok: true };
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
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
