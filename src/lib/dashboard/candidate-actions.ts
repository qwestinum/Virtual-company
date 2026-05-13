'use client';

/**
 * Helpers d'actions DRH sur un candidat (Session 6 v2).
 *
 * Chaque action POST le journal Supabase et déclenche une prise d'acte
 * du Manager dans le chat. La résolution finale du KPI dépend du
 * derive-metrics qui regarde la dernière action wins.
 *
 * Pas de mutation locale du store candidats — la prochaine requête de
 * polling du dashboard re-dérivera tout depuis le journal.
 */

import { useChatStore } from '@/stores/chat-store';

export type InterviewMark = 'realized' | 'missed';
export type ValidationMark = 'validated' | 'rejected';

export async function markCandidateInterview(args: {
  uid: string;
  candidateName: string;
  campaignId: string | null;
  status: InterviewMark;
}): Promise<void> {
  await postJournal({
    action: 'candidate_interview_marked',
    campaignId: args.campaignId,
    payload: {
      uid: args.uid,
      candidate: args.candidateName,
      status: args.status,
    },
  });
  pushChatLine(
    args.status === 'realized'
      ? `J'ai noté que l'entretien avec ${args.candidateName} a eu lieu. Je l'ajoute au compteur entretiens.`
      : `J'ai noté que l'entretien avec ${args.candidateName} n'a pas eu lieu. Je le sors du compteur entretiens.`,
  );
}

export async function markCandidateValidation(args: {
  uid: string;
  candidateName: string;
  campaignId: string | null;
  status: ValidationMark;
}): Promise<void> {
  await postJournal({
    action: 'candidate_validation_marked',
    campaignId: args.campaignId,
    payload: {
      uid: args.uid,
      candidate: args.candidateName,
      status: args.status,
    },
  });
  pushChatLine(
    args.status === 'validated'
      ? `${args.candidateName} est validé définitivement. Je le passe en mode GO et je relance les étapes restantes.`
      : `${args.candidateName} n'est pas retenu sur cette campagne. Je clôture son dossier — pas de GO.`,
  );
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
