/**
 * Helper de prise d'acte du Manager pour les actions directes UI
 * (Session 6 — spec §4.1, §6.3).
 *
 * Quand le donneur d'ordre clique dans le dashboard pour modifier
 * l'état d'une campagne, le Manager doit poster un message court dans
 * la conversation pour conserver l'illusion d'une équipe pilotée par
 * un humain. Cette fonction est l'unique passage par lequel tous les
 * call sites (StatusActions, ScoringEdit, ThresholdEdit, ChannelsEdit)
 * produisent ce message.
 *
 * Deux effets en parallèle :
 *   - pousse un message Manager dans le chat-store ;
 *   - écrit une entrée dans le journal d'audit Supabase (best-effort —
 *     un 503 silencieux ne casse pas la prise d'acte chat).
 *
 * Le message est généré par un mapping d'actions → phrases fixes. On
 * n'appelle pas le LLM ici : ces phrases doivent être instantanées et
 * 100 % prévisibles pour la démo. Le ton reste celui d'un responsable
 * RH humain — pas de jargon technique.
 */

import { useChatStore } from '@/stores/chat-store';

export type AcknowledgmentAction =
  | { kind: 'campaign_created'; campaignId: string; campaignName: string }
  | { kind: 'campaign_paused'; campaignId: string; campaignName: string }
  | { kind: 'campaign_resumed'; campaignId: string; campaignName: string }
  | { kind: 'campaign_closed'; campaignId: string; campaignName: string }
  | { kind: 'campaign_activated'; campaignId: string; campaignName: string }
  | {
      kind: 'threshold_changed';
      campaignId: string;
      campaignName: string;
      previous: number;
      next: number;
    }
  | {
      kind: 'scoring_updated';
      campaignId: string;
      campaignName: string;
    }
  | {
      kind: 'channel_toggled';
      campaignId: string;
      campaignName: string;
      channel: string;
      enabled: boolean;
    };

export function pushManagerAcknowledgment(action: AcknowledgmentAction): void {
  const content = phraseFor(action);
  useChatStore.getState().appendMessage({
    role: 'manager',
    source: 'text',
    content,
  });

  // Audit asynchrone — on n'attend pas la réponse pour ne pas bloquer
  // la prise d'acte (et le journal accepte 503 silencieux).
  void postJournal(action);
}

function phraseFor(action: AcknowledgmentAction): string {
  switch (action.kind) {
    case 'campaign_created':
      return `J'ai enregistré « ${action.campaignName} ». Elle reste en brouillon : activez-la quand vous êtes prêt pour lancer la veille du CV Analyzer.`;
    case 'campaign_paused':
      return `J'ai bien noté que vous avez mis « ${action.campaignName} » en pause. Je suspends la veille du CV Analyzer et les candidatures qui arrivent d'ici la reprise sont mises en file d'attente.`;
    case 'campaign_resumed':
      return `« ${action.campaignName} » est reprise. Je relance la veille du CV Analyzer et je vous fais un point dès qu'il y a du nouveau.`;
    case 'campaign_closed':
      return `« ${action.campaignName} » est clôturée. Je rappatrie le bilan dans les archives et je libère les agents associés.`;
    case 'campaign_activated':
      return `« ${action.campaignName} » est lancée. La diffusion démarre et le CV Analyzer écoute.`;
    case 'threshold_changed': {
      const dir =
        action.next > action.previous
          ? 'plus exigeant'
          : 'plus inclusif';
      return `Vous avez ajusté le seuil d'acceptation de ${action.previous} à ${action.next} sur « ${action.campaignName} » (${dir}). Le nouveau seuil s'applique aux prochaines candidatures — je vous propose un récap quand on aura assez de recul.`;
    }
    case 'scoring_updated':
      return `J'ai bien pris en compte la nouvelle grille de scoring sur « ${action.campaignName} ». Le CV Analyzer va l'utiliser pour les analyses à venir.`;
    case 'channel_toggled':
      return action.enabled
        ? `Le canal ${action.channel} est activé sur « ${action.campaignName} ». Je relance la diffusion sur ce réseau.`
        : `J'ai désactivé ${action.channel} sur « ${action.campaignName} ». Les autres canaux continuent de tourner normalement.`;
  }
}

async function postJournal(action: AcknowledgmentAction): Promise<void> {
  try {
    await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action.kind,
        campaignId: action.campaignId,
        actor: 'user',
        payload: payloadFor(action),
      }),
    });
  } catch {
    // best-effort : un échec réseau n'invalide pas la prise d'acte chat.
  }
}

function payloadFor(action: AcknowledgmentAction): Record<string, unknown> {
  switch (action.kind) {
    case 'campaign_created':
    case 'campaign_paused':
    case 'campaign_resumed':
    case 'campaign_closed':
    case 'campaign_activated':
      return { campaignName: action.campaignName };
    case 'threshold_changed':
      return {
        campaignName: action.campaignName,
        previous: action.previous,
        threshold: action.next,
      };
    case 'scoring_updated':
      return { campaignName: action.campaignName };
    case 'channel_toggled':
      return {
        campaignName: action.campaignName,
        channel: action.channel,
        enabled: action.enabled,
      };
  }
}
