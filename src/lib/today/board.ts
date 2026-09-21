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
import {
  activeReferentOf,
  type ReferentByCampaign,
  type ReferentInfo,
} from '@/lib/referent/filter';
import type { BusinessSignal, BusinessSignalAction } from '@/types/notifications';
import { BUSINESS_SIGNAL_SURFACES } from '@/types/notifications';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

/** Plafond d'une section unitaire — au-delà, « voir les N autres ». */
export const TODAY_SECTION_LIMIT = 5;

export type DecisionItem = {
  id: string;
  /** Référent de la campagne — porté par la ligne, pour le filtre de lecture. */
  referent: ReferentInfo | null;
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
  /** Recruteur affiché — celui qui TIENT le rendez-vous, pas toujours le référent. */
  referent: ReferentInfo | null;
  /** Identité de candidature — nécessaire pour confirmer depuis l'accueil. */
  uid: string | null;
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

/**
 * ⚠️ STRUCTURE — la règle de l'écran, et elle vaut partout :
 *
 *   LA CARTE PORTE LE SUJET   (une couleur, un titre chiffré)
 *   LE SOUS-BLOC PORTE LE VERBE (un sous-titre, un format, un bouton qui
 *                                nomme le geste)
 *
 * Un sujet = une carte. Plusieurs verbes = plusieurs sous-blocs DANS la carte.
 *
 * C'est ce qui a fait fusionner « à décider » et « propositions de refus » :
 * deux cartes de la même couleur, côte à côte, parlaient du même sujet — les
 * candidatures qui attendent une validation — et le lecteur devait deviner
 * pourquoi elles étaient séparées. Elles ne diffèrent que par le GESTE, donc
 * par le sous-bloc.
 *
 * Même raison côté entretiens : « confirmer qu'il a eu lieu » et « donner sa
 * décision » sont deux verbes qui portaient le même bouton « Répondre ». Les
 * séparer en sous-blocs rend l'ordre — confirmer PUIS décider — visible sans
 * qu'on l'explique.
 */
export type TodayBoard = {
  validation: {
    /** Le sujet : tout ce qui attend une validation, toutes formes confondues. */
    total: number;
    /** Verbe « lire et décider » — lignes unitaires. */
    aLire: { items: DecisionItem[]; total: number };
    /** Verbe « passer en revue » — UNE ligne agrégée, jamais une par candidat. */
    aEcarter: { total: number; oldestDays: number; href: string };
  };
  entretiens: {
    total: number;
    /** Verbe « confirmer » : l'entretien a-t-il eu lieu ? */
    aConfirmer: { items: InterviewItem[]; total: number };
    /** Verbe « décider » : retenez-vous ce candidat ? */
    aDecider: { items: InterviewItem[]; total: number };
  };
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
    referent?: ReferentInfo | null;
    uid: string | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
    section: 'a_pointer' | 'a_venir' | 'verdict_attendu';
  }[];
  verdict: {
    briefId: string;
    referent?: ReferentInfo | null;
    uid: string | null;
    candidateName: string;
    campaignId: string | null;
    jobTitle: string | null;
    interviewStartAt: string | null;
  }[];
  signals: BusinessSignal[];
  /** Référent par campagne — sert le filtre de lecture, jamais un droit. */
  referentByCampaign?: ReferentByCampaign;
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
      referent: activeReferentOf(v.campaignId, input.referentByCampaign ?? {}),
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
      // ⚠️ Sur un RDV pris, le recruteur affiché est celui qui le TIENT : la
      // ressource est figée à la confirmation et ne suit pas un re-pointage.
      referent: row.referent ?? null,
      uid: row.uid ?? null,
      candidateName: row.candidateName,
      campaignId: row.campaignId,
      jobTitle: row.jobTitle,
      startAt: row.interviewStartAt,
      kind: 'a_eu_lieu' as const,
      href: interviewsHref({ campaignId: row.campaignId, section: 'a_pointer' }),
    }));
  const verdicts: InterviewItem[] = input.verdict.map((row) => ({
    id: row.briefId,
    referent: row.referent ?? null,
    uid: row.uid ?? null,
    candidateName: row.candidateName,
    campaignId: row.campaignId,
    jobTitle: row.jobTitle,
    startAt: row.interviewStartAt,
    kind: 'retenu' as const,
    href: interviewsHref({ campaignId: row.campaignId }),
  }));


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
    validation: {
      total: decidable.length + actionableProposals.length,
      aLire: { items: decideItems, total: decidable.length },
      aEcarter: {
        total: actionableProposals.length,
        oldestDays: oldestProposal,
        href: '/candidatures/validation',
      },
    },
    entretiens: {
      total: toPoint.length + verdicts.length,
      aConfirmer: {
        items: toPoint.slice(0, TODAY_SECTION_LIMIT),
        total: toPoint.length,
      },
      aDecider: {
        items: verdicts.slice(0, TODAY_SECTION_LIMIT),
        total: verdicts.length,
      },
    },
    verify: { items: verify, total: verify.length },
    allClear:
      decidable.length === 0 &&
      actionableProposals.length === 0 &&
      toPoint.length === 0 &&
      verdicts.length === 0 &&
      verify.length === 0,
  };
}
