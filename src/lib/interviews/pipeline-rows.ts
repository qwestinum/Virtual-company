/**
 * Lignes des deux onglets « Entretiens » — PUR.
 *
 * La source est `interview_briefs`, table UNIQUE aux deux régimes : un
 * briefing Cal.com et un briefing natif ne diffèrent que par l'origine de leur
 * `booking_uid`. Aucun filtre par régime — c'est ce qui fait que la page sert
 * la coexistence par construction, et non par un branchement de plus.
 *
 * Deux règles de sélection, toutes deux nécessaires :
 *
 *   1. la candidature doit être ENCORE OUVERTE. Un briefing reste en base
 *      quand la décision est prise ailleurs (marquage depuis le menu
 *      Candidatures, verdict) : sans ce filtre, la page proposerait de pointer
 *      un entretien déjà tranché. C'est le même mécanisme qui éteint les
 *      signaux métier — l'étape courante fait foi, il n'y a pas d'état parallèle.
 *
 *   2. une candidature = une ligne. Deux briefings pour un même uid (repli de
 *      régénération) donnent la ligne la plus récente, jamais deux.
 *
 * Les builders rendent AUSSI ce qu'ils ont écarté faute de candidature
 * retrouvable. Un briefing dont l'uid ne correspond à aucune analyse
 * disparaîtrait sinon de l'écran sans un mot — et le compteur de l'onglet,
 * s'il comptait la table, annoncerait 5 là où la liste en montre 3.
 */

export type BriefFacts = {
  briefId: string;
  uid: string | null;
  campaignId: string | null;
  candidateName: string;
  candidateEmail: string | null;
  jobTitle: string | null;
  /** Bascule d'état la plus récente — base de l'ancienneté. */
  updatedAt: string;
  createdAt: string;
  /** `scheduled` seulement. */
  interviewStartAt: string | null;
  interviewEndAt: string | null;
  interviewLocation: string | null;
  /** Identifiant de réservation : natif (uuid du module) ou uid Cal.com. */
  bookingUid: string | null;
};

/** Étapes où une candidature attend encore quelque chose de nous. */
const OPEN_STAGES = new Set(['invite', 'rdv_pris', 'entretien_fait']);

export type OpenStageLookup = (uid: string) => string | null;

export type AwaitingRow = BriefFacts & {
  /** Jours ENTIERS depuis la mise (ou remise) en attente. */
  waitingDays: number;
  /** `true` au-delà du seuil : l'invitation traîne. */
  overdue: boolean;
  /** Identité de candidature — clé de réémission et de classement. */
  analysisId: string | null;
  /** `null` = régime Cal.com : il n'existe aucun objet lien à interroger. */
  linkStatus: 'active' | 'expired' | 'revoked' | 'used' | null;
};

export type ScheduledSection = 'a_pointer' | 'a_venir' | 'verdict_attendu';

export type ScheduledRow = BriefFacts & {
  section: ScheduledSection;
  analysisId: string | null;
  /** Étape courante — décide des actions offertes. */
  stage: string;
};

export function daysBetween(fromIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 86_400_000));
}

/** Une ligne par candidature : le briefing le plus récemment touché gagne. */
function dedupeByUid<T extends BriefFacts>(briefs: T[]): T[] {
  const best = new Map<string, T>();
  for (const brief of briefs) {
    const key = brief.uid ?? `brief:${brief.briefId}`;
    const kept = best.get(key);
    if (!kept || kept.updatedAt < brief.updatedAt) best.set(key, brief);
  }
  return [...best.values()];
}

/** Candidature encore ouverte ? Un uid inconnu est EXCLU — on ne devine pas. */
function isOpen(uid: string | null, stageOf: OpenStageLookup): boolean {
  if (!uid) return false;
  const stage = stageOf(uid);
  return stage !== null && OPEN_STAGES.has(stage);
}

/** Ce qu'un builder a écarté faute de candidature retrouvable. */
export type BuildResult<T> = { rows: T[]; unresolved: number };

/** Briefings dont l'uid ne correspond à AUCUNE analyse connue. */
function countUnresolved(
  briefs: BriefFacts[],
  stageOf: OpenStageLookup,
): number {
  return briefs.filter((b) => b.uid === null || stageOf(b.uid) === null).length;
}

export function buildAwaitingRows(
  briefs: BriefFacts[],
  ctx: {
    nowMs: number;
    thresholdDays: number;
    stageOf: OpenStageLookup;
    analysisIdOf: (uid: string) => string | null;
    linkStatusOf: (analysisId: string) => AwaitingRow['linkStatus'];
  },
): BuildResult<AwaitingRow> {
  const deduped = dedupeByUid(briefs);
  const rows = deduped
    .filter((brief) => isOpen(brief.uid, ctx.stageOf))
    .map((brief) => {
      const analysisId = brief.uid ? ctx.analysisIdOf(brief.uid) : null;
      const waitingDays = daysBetween(brief.updatedAt, ctx.nowMs);
      return {
        ...brief,
        waitingDays,
        overdue: waitingDays >= ctx.thresholdDays,
        analysisId,
        linkStatus: analysisId ? ctx.linkStatusOf(analysisId) : null,
      };
    })
    // Le plus ancien d'abord : c'est celui qui demande une décision.
    .sort((a, b) => b.waitingDays - a.waitingDays);
  return { rows, unresolved: countUnresolved(deduped, ctx.stageOf) };
}

export function buildScheduledRows(
  briefs: BriefFacts[],
  ctx: {
    nowMs: number;
    /** Un entretien terminé depuis plus de N heures attend un pointage. */
    pointingAgeHours: number;
    stageOf: OpenStageLookup;
    analysisIdOf: (uid: string) => string | null;
  },
): BuildResult<ScheduledRow> {
  const pointingCutoff = ctx.nowMs - ctx.pointingAgeHours * 3_600_000;

  const deduped = dedupeByUid(briefs);
  const rows = deduped
    .filter((brief) => isOpen(brief.uid, ctx.stageOf))
    .map((brief) => {
      const stage = (brief.uid ? ctx.stageOf(brief.uid) : null) ?? 'invite';
      // L'entretien marqué réalisé attend un verdict — il n'est plus « à
      // pointer », et il ne doit pas non plus disparaître de la page.
      const section: ScheduledSection =
        stage === 'entretien_fait'
          ? 'verdict_attendu'
          : brief.interviewEndAt && Date.parse(brief.interviewEndAt) < pointingCutoff
            ? 'a_pointer'
            : 'a_venir';
      return {
        ...brief,
        section,
        stage,
        analysisId: brief.uid ? ctx.analysisIdOf(brief.uid) : null,
      };
    });

  // Ce qui demande une action d'abord, le reste par ordre chronologique.
  const rank: Record<ScheduledSection, number> = {
    a_pointer: 0,
    a_venir: 1,
    verdict_attendu: 2,
  };
  return {
    rows: rows.sort(
      (a, b) =>
        rank[a.section] - rank[b.section] ||
        (a.section === 'a_venir'
          ? (a.interviewStartAt ?? '').localeCompare(b.interviewStartAt ?? '')
          : (b.interviewStartAt ?? '').localeCompare(a.interviewStartAt ?? '')),
    ),
    unresolved: countUnresolved(deduped, ctx.stageOf),
  };
}
