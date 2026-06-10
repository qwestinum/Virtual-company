/**
 * Helpers d'AFFICHAGE du rapport multi-campagnes (cf. docs/specs/reporting.md
 * §4). CLIENT-SAFE & PUR : presets de chips, nom de fichier, valeurs
 * pré-remplies de la modale d'envoi, période par défaut.
 */

import { formatFrDate, slugForFileName } from '@/lib/reporting/audit-display';
import {
  presetsByKeys,
  type PeriodPresetKey,
  type PeriodRange,
} from '@/lib/reporting/period-presets';
import type { MultiCampaignFilterLabels } from '@/types/reporting';

/**
 * Chips du multi-campagnes — couvre les durées courtes ET longues (les 8
 * presets existants). Les libellés sont ceux de `period-presets.ts`.
 */
export const MULTI_CAMPAIGN_PERIOD_PRESET_KEYS: PeriodPresetKey[] = [
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
];

/** Période par défaut au chargement = « Ce mois » (pré-remplie). */
export function defaultMultiCampaignPeriod(referenceDate: Date): PeriodRange {
  return presetsByKeys(['this_month'])[0]!.range(referenceDate);
}

/**
 * Nom de fichier :
 * `ORQA-rapport-multi-campagnes-[from]-au-[to][-donneur][-site].pdf`.
 */
export function multiCampaignReportFileName(
  from: string,
  to: string,
  filters?: { donneurLabel?: string | null; siteLabel?: string | null },
): string {
  let name = `ORQA-rapport-multi-campagnes-${from}-au-${to}`;
  if (filters?.donneurLabel) name += `-${slugForFileName(filters.donneurLabel)}`;
  if (filters?.siteLabel) name += `-${slugForFileName(filters.siteLabel)}`;
  return `${name}.pdf`;
}

/** Valeurs pré-remplies de la modale d'envoi en contexte multi-campagnes. */
export function multiCampaignSendDefaults(
  period: { from: string; to: string },
  campaignCount: number,
  filters?: MultiCampaignFilterLabels,
): { subject: string; message: string; attachmentName: string } {
  const from = formatFrDate(period.from);
  const to = formatFrDate(period.to);
  return {
    subject: `Rapport multi-campagnes — Du ${from} au ${to}`,
    message: [
      'Bonjour,',
      '',
      `Vous trouverez en pièce jointe le rapport multi-campagnes couvrant la période du ${from} au ${to}.`,
      `Ce rapport agrège ${campaignCount} campagne${campaignCount > 1 ? 's' : ''} clôturée${campaignCount > 1 ? 's' : ''} sur la période et présente une vue consolidée des performances, des canaux les plus efficaces, et des recommandations transverses pour le pilotage du recrutement.`,
      '',
      'Bonne lecture,',
      'ORQA',
    ].join('\n'),
    attachmentName: multiCampaignReportFileName(period.from, period.to, {
      donneurLabel: filters?.donneurLabel,
      siteLabel: filters?.siteLabel,
    }),
  };
}
