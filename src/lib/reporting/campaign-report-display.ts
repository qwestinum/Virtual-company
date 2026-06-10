/**
 * Helpers d'AFFICHAGE du rapport de campagne (cf. docs/specs/reporting.md §3).
 * CLIENT-SAFE & PUR : libellés, nom de fichier, tri, filtres et mentions de
 * carte. Le filtrage / tri / pagination tournent côté client (volume MVP
 * faible) — testés ici.
 */

import { formatFrDate, slugForFileName } from '@/lib/reporting/audit-display';
import type {
  CampaignIssueKind,
  CampaignReportSummary,
} from '@/types/reporting';

export const CAMPAIGN_ISSUE_LABELS: Record<CampaignIssueKind, string> = {
  recruited: 'Recrutement finalisé',
  no_hire: 'Clôturée sans recrutement',
};

/** Clés de tri proposées dans le sélecteur. */
export type CampaignSortKey =
  | 'closed_desc'
  | 'closed_asc'
  | 'name_asc'
  | 'duration_desc';

export const CAMPAIGN_SORT_LABELS: Record<CampaignSortKey, string> = {
  closed_desc: 'Date de clôture (récent → ancien)',
  closed_asc: 'Date de clôture (ancien → récent)',
  name_asc: 'Nom de campagne (A → Z)',
  duration_desc: 'Durée (plus longue → plus courte)',
};

/**
 * Nom de fichier canonique :
 * `ORQA-rapport-campagne-[nom-poste]-[date-cloture].pdf`.
 */
export function campaignReportFileName(
  jobTitle: string,
  closedAtIso: string,
): string {
  const day = closedAtIso.slice(0, 10); // YYYY-MM-DD
  return `ORQA-rapport-campagne-${slugForFileName(jobTitle)}-${day}.pdf`;
}

/** Mention « Rapport envoyé N fois — dernier envoi le … » (null si jamais). */
export function sentMention(summary: CampaignReportSummary): string | null {
  const n = summary.sends.length;
  if (n === 0) return null;
  const last = summary.sends[0]!.at; // sends triés décroissant
  return `Rapport envoyé ${n} fois — dernier envoi le ${formatFrDate(last)}`;
}

/** Mention « Rapport généré le … » (null si pas encore en cache). */
export function generatedMention(summary: CampaignReportSummary): string | null {
  return summary.generatedAt
    ? `Rapport généré le ${formatFrDate(summary.generatedAt)}`
    : null;
}

/** Libellé donneur d'ordre « Nom (rôle) » ou « — ». */
export function donneurOrdreLabel(summary: CampaignReportSummary): string {
  const d = summary.donneurOrdre;
  if (!d) return '—';
  return d.role ? `${d.label} (${d.role})` : d.label;
}

export type CampaignFilters = {
  /** Recherche libre (poste, intitulé campagne, donneur d'ordre). */
  search?: string;
  /** Borne basse de clôture (ISO day) incluse. */
  from?: string;
  /** Borne haute de clôture (ISO day) incluse. */
  to?: string;
  /** Filtre donneur d'ordre par id ('' = tous). */
  donneurOrdreId?: string;
  /** Filtre site par id ('' = tous). */
  siteId?: string;
};

/** Applique les 3 filtres combinés (ET logique). PUR. */
export function filterCampaignSummaries(
  items: CampaignReportSummary[],
  filters: CampaignFilters,
): CampaignReportSummary[] {
  const q = (filters.search ?? '').trim().toLowerCase();
  return items.filter((it) => {
    if (q) {
      const hay = [
        it.jobTitle,
        it.campaignName,
        it.donneurOrdre?.label ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.donneurOrdreId && it.donneurOrdreId !== filters.donneurOrdreId) {
      return false;
    }
    if (filters.siteId && it.siteId !== filters.siteId) return false;
    // Période sur la date de clôture (jour ISO comparable lexicographiquement).
    const day = it.closedAt.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });
}

/** Trie une copie selon la clé. PUR. */
export function sortCampaignSummaries(
  items: CampaignReportSummary[],
  key: CampaignSortKey,
): CampaignReportSummary[] {
  const out = [...items];
  switch (key) {
    case 'closed_asc':
      return out.sort((a, b) => a.closedAt.localeCompare(b.closedAt));
    case 'name_asc':
      return out.sort((a, b) =>
        a.campaignName.localeCompare(b.campaignName, 'fr', { sensitivity: 'base' }),
      );
    case 'duration_desc':
      return out.sort((a, b) => b.durationDays - a.durationDays);
    case 'closed_desc':
    default:
      return out.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  }
}

/** Compteur « N campagnes clôturées sur la période sélectionnée ». */
export function resultCountLabel(count: number): string {
  return `${count} campagne${count > 1 ? 's' : ''} clôturée${count > 1 ? 's' : ''} sur la période sélectionnée`;
}

/**
 * Valeurs pré-remplies de la modale d'envoi en contexte rapport de campagne
 * (cf. docs/specs/reporting.md §3.5). PUR & testable.
 */
/** Rappel de campagne pour l'objet du mail : intitulé distinct + identifiant. */
export function campaignSubjectRef(summary: CampaignReportSummary): string {
  return summary.campaignName && summary.campaignName !== summary.jobTitle
    ? `${summary.campaignName} · ${summary.campaignId}`
    : summary.campaignId;
}

export function campaignSendDefaults(summary: CampaignReportSummary): {
  subject: string;
  message: string;
  attachmentName: string;
} {
  return {
    // Rappel de la campagne (pas juste le poste) dans l'objet.
    subject: `Rapport de campagne — ${summary.jobTitle} (${campaignSubjectRef(summary)})`,
    message: [
      'Bonjour,',
      '',
      `Vous trouverez en pièce jointe le rapport de la campagne de recrutement « ${summary.jobTitle} », clôturée le ${formatFrDate(summary.closedAt)}.`,
      "Ce rapport synthétise le déroulé de la campagne, les performances par canal, l'analyse du scoring, et les enseignements pour les prochaines campagnes.",
      '',
      'Bonne lecture,',
      'ORQA',
    ].join('\n'),
    attachmentName: campaignReportFileName(summary.jobTitle, summary.closedAt),
  };
}
