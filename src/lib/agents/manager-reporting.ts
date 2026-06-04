/**
 * Réponses DÉTERMINISTES du Manager pour le suivi de campagne
 * (`campaign_followup`) et le reporting transverse (`reporting_request`).
 *
 * Aucune génération LLM : on restitue des chiffres réels dérivés du
 * journal d'audit + de l'état des campagnes. Pures (données en entrée →
 * ManagerResponse en sortie), donc testables sans réseau.
 */

import {
  journalToCampaignMetric,
  journalToGlobalKPIs,
} from '@/lib/dashboard/derive-metrics';
import type { JournalEntry } from '@/lib/db/repos/journal';
import type { ManagerResponse } from '@/types/manager-response';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { CAMPAIGN_STATUS_LABELS } from '@/types/campaign-status';

export type ReportingSnapshot = {
  campaigns: ActiveCampaign[];
  journal: JournalEntry[];
};

const DATA_UNAVAILABLE =
  "Je n'arrive pas à récupérer les données des campagnes pour le moment. Réessayez dans un instant.";

const CAMPAIGN_ID_RE = /CAMP-\d{4}-\d{3}/i;

function isOpen(c: ActiveCampaign): boolean {
  return c.status !== 'closed';
}

function campaignLabel(c: ActiveCampaign): string {
  return `${c.name} (${c.id})`;
}

/**
 * Résout la campagne visée par un message de suivi :
 *   - 'found'     : identifiée sans ambiguïté (ID explicite, intitulé
 *                   reconnu, ou unique campagne ouverte) ;
 *   - 'ambiguous' : plusieurs candidates — on demandera laquelle ;
 *   - 'empty'     : aucune campagne du tout.
 */
export function resolveCampaign(
  message: string,
  campaigns: ActiveCampaign[],
):
  | { kind: 'found'; campaign: ActiveCampaign }
  | { kind: 'ambiguous'; candidates: ActiveCampaign[] }
  | { kind: 'empty' } {
  if (campaigns.length === 0) return { kind: 'empty' };

  const idMatch = message.match(CAMPAIGN_ID_RE);
  if (idMatch) {
    const byId = campaigns.find(
      (c) => c.id.toLowerCase() === idMatch[0].toLowerCase(),
    );
    if (byId) return { kind: 'found', campaign: byId };
  }

  const lower = message.toLowerCase();
  const byName = campaigns.filter(
    (c) => c.name.trim().length > 0 && lower.includes(c.name.toLowerCase()),
  );
  if (byName.length === 1) return { kind: 'found', campaign: byName[0] };
  if (byName.length > 1) return { kind: 'ambiguous', candidates: byName };

  // Pas de référence dans le message — si une seule campagne ouverte, c'est
  // forcément elle ; sinon on demande laquelle.
  const open = campaigns.filter(isOpen);
  if (open.length === 1) return { kind: 'found', campaign: open[0] };
  if (open.length === 0) return { kind: 'ambiguous', candidates: campaigns };
  return { kind: 'ambiguous', candidates: open };
}

export function buildCampaignFollowupResponse(
  snapshot: ReportingSnapshot | null,
  message: string,
): ManagerResponse {
  if (!snapshot) return { message: DATA_UNAVAILABLE };

  const resolved = resolveCampaign(message, snapshot.campaigns);

  if (resolved.kind === 'empty') {
    return {
      message:
        "Il n'y a aucune campagne pour l'instant. Souhaitez-vous en lancer une ?",
      chips: {
        placement: 'below_bubble',
        options: ['Lancer un recrutement'],
      },
    };
  }

  if (resolved.kind === 'ambiguous') {
    const options = resolved.candidates.slice(0, 4).map(campaignLabel);
    return {
      message: 'Sur quelle campagne souhaitez-vous le point ?',
      chips: { placement: 'below_bubble', options },
    };
  }

  const c = resolved.campaign;
  const m = journalToCampaignMetric(snapshot.journal, c.id);
  const statusLabel = CAMPAIGN_STATUS_LABELS[c.status];
  const message_ = [
    `Voici où en est ${c.name} (${c.id}) — statut : ${statusLabel}.`,
    '',
    `- CV reçus : ${m.candidates}`,
    `- Shortlistés / Invités : ${m.shortlisted}`,
    `- Entretiens : ${m.interviews}`,
    `- GO : ${m.goCount}`,
    `- Score moyen : ${m.avgScore != null ? `${m.avgScore}/100` : '—'}`,
  ].join('\n');

  return {
    message: message_,
    chips: {
      placement: 'below_bubble',
      options: ['Faire un point global'],
    },
  };
}

export function buildReportingResponse(
  snapshot: ReportingSnapshot | null,
): ManagerResponse {
  if (!snapshot) return { message: DATA_UNAVAILABLE };

  const { campaigns, journal } = snapshot;
  const kpis = journalToGlobalKPIs(journal);
  const open = campaigns.filter(isOpen);

  const header = [
    `Point global — ${campaigns.length} campagne${campaigns.length > 1 ? 's' : ''} (${open.length} ouverte${open.length > 1 ? 's' : ''}).`,
    '',
    `- CV reçus : ${kpis.cvReceived}`,
    `- Shortlistés / Invités : ${kpis.shortlisted}`,
    `- Entretiens : ${kpis.interviews}`,
    `- GO : ${kpis.go}`,
    `- Conversion : ${kpis.conversion}%`,
    `- Coût IA estimé : ${kpis.costEstimate.toFixed(2)} €`,
  ];

  const perCampaign = open.slice(0, 8).map((c) => {
    const m = journalToCampaignMetric(journal, c.id);
    return `- ${c.name} (${c.id}) — ${CAMPAIGN_STATUS_LABELS[c.status]} : ${m.candidates} CV, ${m.shortlisted} shortlistés, ${m.goCount} GO`;
  });

  const body =
    perCampaign.length > 0
      ? ['', 'Par campagne :', ...perCampaign]
      : ['', "Aucune campagne ouverte pour l'instant."];

  // Chips : un point ciblé sur les premières campagnes ouvertes, sinon
  // amorce d'un recrutement (chips toujours présents).
  const options =
    open.length > 0
      ? open.slice(0, 3).map((c) => `Point sur ${c.id}`)
      : ['Lancer un recrutement'];

  return {
    message: [...header, ...body].join('\n'),
    chips: { placement: 'below_bubble', options },
  };
}
