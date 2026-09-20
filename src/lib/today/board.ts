/**
 * *Aujourd'hui* — ce qui attend une action, en quatre sections. PUR, testé.
 *
 * Principe verrouillé de la maquette v2 : **une section = une nature d'action
 * = un verbe**. Aucune section ne mélange des dossiers qui appellent des
 * gestes différents, parce qu'une liste qu'on ne peut pas traiter d'un seul
 * geste n'est pas une liste de travail, c'est un inventaire.
 *
 * Ce module ne lit rien : il reçoit ce qui a déjà été chargé et décide de la
 * répartition, des compteurs et des destinations. C'est ce qui permet de
 * TESTER la promesse « chaque ligne mène à la vue filtrée annoncée » sans
 * rendre un seul composant.
 *
 * ⚠️ La partition « à décider » / « propositions de refus » réutilise
 * `partitionRejectionProposals`, la MÊME fonction que la file d'arbitrage.
 * La recopier ici ferait deux règles pour une seule frontière, et elles
 * divergeraient : l'écran d'accueil annoncerait un nombre que l'écran de
 * travail ne montrerait pas.
 */

import {
  partitionRejectionProposals,
  sortRejectionProposals,
} from '@/lib/hitl/rejection-proposal';
import type { ValidationCoherence } from '@/lib/hitl/queue-coherence';
import {
  candidaturesHref,
  interviewsHref,
  signalHref,
} from '@/lib/navigation/workspace-routes';
import type { BusinessSignal, BusinessSignalAction } from '@/types/notifications';
import { BUSINESS_SIGNAL_SURFACES } from '@/types/notifications';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

/** Plafond d'une section unitaire — au-delà, « voir les N autres ». */
export const TODAY_SECTION_LIMIT = 5;

export type DecisionItem = {
  id: string;
  candidateName: string;
  score: number | null;
  campaignId: string;
  /** Ancienneté en jours entiers — ce qui fait remonter un dossier. */
  waitingDays: number;
  /** La candidature de CE dossier, dans la vue filtrée. */
  href: string;
};

export type InterviewItem = {
  id: string;
  candidateName: string;
  campaignId: string | null;
  /** Intitulé du poste — la colonne « campagne » de la ligne. */
  jobTitle: string | null;
  /** Début de l'entretien, quand il est connu. */
  startAt: string | null;
  /**
   * Ce qu'on attend, et l'ordre dans lequel ça se pose : d'abord savoir si
   * l'entretien a eu lieu, ensuite seulement si le candidat est retenu.
   */
  kind: 'a_eu_lieu' | 'retenu';
  href: string;
};

export type VerificationItem = {
  key: string;
  message: string;
  ctaLabel: string;
  href: string;
  /** Présent quand le point se RÉPARE d'un geste, au lieu de s'ouvrir. */
  action?: BusinessSignalAction;
};

export type TodayBoard = {
  decide: { items: DecisionItem[]; total: number };
  /** Une SEULE ligne agrégée, jamais une ligne par candidat. */
  proposals: { total: number; oldestDays: number; href: string };
  interviews: { items: InterviewItem[]; total: number };
  verify: { items: VerificationItem[]; total: number };
  /** Rien nulle part : l'écran dit une phrase, pas quatre cartes vides. */
  allClear: boolean;
};

export type TodayInput = {
  validations: PendingValidation[];
  zoneByValidation: Record<string, DecisionZone | null>;
  coherenceByValidation: Record<string, ValidationCoherence | undefined>;
  scheduled: {
    briefId: string;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
    section: 'a_pointer' | 'a_venir' | 'verdict_attendu';
  }[];
  verdict: {
    briefId: string;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
  }[];
  signals: BusinessSignal[];
  nowMs: number;
};

function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86_400_000));
}

/**
 * Un dossier dont la fiche ne correspond plus à l'analyse est INDÉCIDABLE :
 * la file le désarme, on ne le propose donc pas ici. Il n'est pas perdu pour
 * autant — le signal `validations_incoherentes` le compte, et ce signal vit en
 * « À vérifier ». Le lister dans « À décider » recréerait très exactement le
 * cul-de-sac que la refonte doit supprimer : un chiffre cliquable qui ne mène
 * à aucun geste possible.
 */
function isActionable(
  v: PendingValidation,
  coherence: Record<string, ValidationCoherence | undefined>,
): boolean {
  return coherence[v.id]?.kind !== 'settled';
}

export function buildTodayBoard(input: TodayInput): TodayBoard {
  const { proposals, toExamine } = partitionRejectionProposals(
    input.validations,
    input.zoneByValidation,
  );

  // ── À décider : arbitrer, à l'unité ──────────────────────────────────────
  const decidable = toExamine.filter((v) =>
    isActionable(v, input.coherenceByValidation),
  );
  const decideItems = [...decidable]
    // Le plus ancien d'abord : c'est l'attente qui fait la priorité, pas le
    // score — un dossier oublié depuis trois semaines passe avant un bon CV
    // arrivé ce matin.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, TODAY_SECTION_LIMIT)
    .map((v) => ({
      id: v.id,
      candidateName: v.candidateName,
      score: v.score,
      campaignId: v.campaignId,
      waitingDays: daysSince(v.createdAt, input.nowMs),
      href: candidaturesHref({ campaignId: v.campaignId, stage: 'a_valider' }),
    }));

  // ── Propositions de refus : passer en revue, en une fois ─────────────────
  const actionableProposals = sortRejectionProposals(proposals).filter((v) =>
    isActionable(v, input.coherenceByValidation),
  );
  const oldestProposal = actionableProposals.reduce(
    (max, v) => Math.max(max, daysSince(v.createdAt, input.nowMs)),
    0,
  );

  // ── Entretiens : pointer d'abord, donner le verdict ensuite ──────────────
  // L'ordre n'est pas cosmétique : un verdict se pose SUR un entretien pointé.
  // Montrer les verdicts d'abord ferait commencer par la fin.
  const toPoint: InterviewItem[] = input.scheduled
    .filter((row) => row.section === 'a_pointer')
    .map((row) => ({
      id: row.briefId,
      candidateName: row.candidateName,
      campaignId: row.campaignId,
      jobTitle: row.jobTitle,
      startAt: row.interviewStartAt,
      kind: 'a_eu_lieu' as const,
      href: interviewsHref({ campaignId: row.campaignId, section: 'a_pointer' }),
    }));
  const verdicts: InterviewItem[] = input.verdict.map((row) => ({
    id: row.briefId,
    candidateName: row.candidateName,
    campaignId: row.campaignId,
    jobTitle: row.jobTitle,
    startAt: row.interviewStartAt,
    kind: 'retenu' as const,
    href: interviewsHref({ campaignId: row.campaignId }),
  }));
  const interviewItems = [...toPoint, ...verdicts];

  // ── À vérifier : des réglages et des campagnes. JAMAIS un candidat ───────
  // La frontière est portée par le registre des signaux, pas par une liste
  // tenue ici : un signal ajouté demain choisit sa surface à sa déclaration.
  const verify = input.signals
    .filter((s) => BUSINESS_SIGNAL_SURFACES[s.key] === 'verification')
    .map((s) => ({
      key: s.key,
      message: s.message,
      ctaLabel: s.ctaLabel,
      // `signalHref` et pas un repli maison : `validations_incoherentes`
      // porte une cible d'ONGLET, pas une route. Un repli « vers les
      // campagnes » l'aurait envoyé là où le problème n'est pas.
      href: signalHref(s.target),
      action: s.action,
    }));

  return {
    decide: { items: decideItems, total: decidable.length },
    proposals: {
      total: actionableProposals.length,
      oldestDays: oldestProposal,
      href: '/candidatures/validation',
    },
    interviews: {
      items: interviewItems.slice(0, TODAY_SECTION_LIMIT),
      total: interviewItems.length,
    },
    verify: { items: verify, total: verify.length },
    allClear:
      decidable.length === 0 &&
      actionableProposals.length === 0 &&
      interviewItems.length === 0 &&
      verify.length === 0,
  };
}
