/**
 * Onglet « Historique » de la page Entretiens — PUR.
 *
 * Qui a rencontré qui, quand, et avec quel verdict. La source est la même que
 * celle des autres onglets (`interview_briefs`) et le verdict est LU de
 * l'étape dérivée (`stageFor`) : aucun état parallèle, aucune colonne neuve.
 *
 * Trois règles de sélection :
 *
 *   1. un entretien PASSÉ — le créneau est terminé. Les entretiens à venir
 *      vivent dans « Programmés » (arbitrage du 24/09/2026 : pas de doublon
 *      entre onglets) ;
 *
 *   2. un créneau RÉSERVÉ (`bookingUid` + date). Un briefing annulé par un
 *      classement sans suite GARDE ses faits de réservation — c'est ainsi
 *      qu'un candidat rencontré puis classé figure encore à l'historique. Mais
 *      un classement ne prouve pas que la rencontre a eu lieu : sans marqueur
 *      d'entretien, la ligne n'est PAS montrée (on ne fabrique pas un
 *      entretien que personne n'a constaté) ;
 *
 *   3. une candidature = une ligne (le briefing le plus récemment touché).
 *
 * « Absent » est distinct de « Non retenu » (arbitrage du 24/09/2026) : la
 * dérivation range l'absence en non retenu, mais personne n'a rien évalué —
 * écrire « Non retenu » ferait lire un jugement là où il n'y en a pas.
 */

import type { BriefFacts } from './pipeline-rows';

export type HistoryVerdict =
  | 'a_pointer'
  | 'verdict_attendu'
  | 'retenu'
  | 'non_retenu'
  | 'absent'
  | 'sans_suite';

export const HISTORY_VERDICT_LABELS: Record<HistoryVerdict, string> = {
  a_pointer: 'En cours · à confirmer',
  verdict_attendu: 'En cours · verdict attendu',
  retenu: 'Retenu',
  non_retenu: 'Non retenu',
  absent: 'Absent',
  sans_suite: 'Classée sans suite',
};

export type HistoryRow = BriefFacts & {
  verdict: HistoryVerdict;
  analysisId: string | null;
};

export type InterviewMarkLookup = (uid: string) => 'realized' | 'missed' | null;

/** Le verdict à afficher, ou `null` si la ligne n'a pas sa place ici. */
export function historyVerdict(
  stage: string | null,
  mark: 'realized' | 'missed' | null,
): HistoryVerdict | null {
  switch (stage) {
    case 'invite':
    case 'rdv_pris':
      return 'a_pointer';
    case 'entretien_fait':
      return 'verdict_attendu';
    case 'retenu':
      return 'retenu';
    case 'non_retenu':
      return mark === 'missed' ? 'absent' : 'non_retenu';
    case 'sans_suite':
      // Classée après une rencontre CONSTATÉE seulement (règle 2).
      if (mark === 'missed') return 'absent';
      return mark === 'realized' ? 'sans_suite' : null;
    default:
      // Étape inconnue ou hors du cycle d'entretien (dossier ré-ouvert en
      // attente de validation…) : on ne devine pas.
      return null;
  }
}

function dedupeByUid(briefs: BriefFacts[]): BriefFacts[] {
  const best = new Map<string, BriefFacts>();
  for (const brief of briefs) {
    const key = brief.uid ?? `brief:${brief.briefId}`;
    const kept = best.get(key);
    if (!kept || kept.updatedAt < brief.updatedAt) best.set(key, brief);
  }
  return [...best.values()];
}

export function buildHistoryRows(
  briefs: BriefFacts[],
  ctx: {
    nowMs: number;
    stageOf: (uid: string) => string | null;
    interviewMarkOf: InterviewMarkLookup;
    analysisIdOf: (uid: string) => string | null;
  },
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const brief of dedupeByUid(briefs)) {
    if (!brief.uid || !brief.bookingUid || !brief.interviewStartAt) continue;
    const end = Date.parse(brief.interviewEndAt ?? brief.interviewStartAt);
    if (!Number.isFinite(end) || end >= ctx.nowMs) continue;
    const verdict = historyVerdict(
      ctx.stageOf(brief.uid),
      ctx.interviewMarkOf(brief.uid),
    );
    if (!verdict) continue;
    rows.push({ ...brief, verdict, analysisId: ctx.analysisIdOf(brief.uid) });
  }
  // Le plus récent d'abord : c'est un registre, on le lit en remontant.
  return rows.sort((a, b) =>
    (b.interviewStartAt ?? '').localeCompare(a.interviewStartAt ?? ''),
  );
}
