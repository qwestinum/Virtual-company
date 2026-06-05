/**
 * Banque de CV fictifs représentatifs pour le scoreur (C2).
 *
 * Chaque fixture sert à DEUX niveaux de la pyramide de tests :
 *   - C2 (ici) : `decisions` pré-extraites → scoreCandidat → `expectedScoreResult`
 *     vérifié en EXACTITUDE (tolérance 0, car la fonction est pure).
 *   - C4 (plus tard) : `cvText` rejoué dans le pipeline extraction LLM + scoreur,
 *     score attendu à ±2 (`meta.expectedC4Range`).
 *
 * Les scores `expectedScoreResult.totalScore` sont calculés à la main depuis la
 * formule (option B) : base = Σ_SOFT(poids × facteur) / Σ_SOFT(poids) × 100,
 * facteur satisfait=1 / partiel=0.5 / non=0 / non_verifiable=0 ; HARD hors
 * moyenne ; cap = seuil-1 = 74 ; knockout ⇒ rejected, score conservé.
 */

import type { LlmCriterionVerdict } from '@/lib/scoring';
import {
  buildCriterion,
  type CandidateStatus,
  type CriterionFailure,
  type ScoringSheet,
} from '@/types/scoring';

export type CVSampleFixture = {
  meta: {
    name: string;
    description: string;
    /** Plage de score tolérée pour le pipeline complet en C4 (±2). */
    expectedC4Range: [number, number];
  };
  /** CV brut — documentaire en C2, rejoué dans l'extraction en C4. */
  cvText: string;
  scoringSheet: ScoringSheet;
  decisions: LlmCriterionVerdict[];
  /** Champs structurants attendus (le breakdown se reconstruit et se vérifie). */
  expectedScoreResult: {
    totalScore: number;
    status: CandidateStatus;
    hardFailures: CriterionFailure[];
  };
};

const ACCEPTANCE = 75;

/** Fiche « Comptable senior » : KO(p0) + CAP(p10) + 4 SOFT [8,6,4,2] (den 20). */
function comptableSeniorSheet(): ScoringSheet {
  return {
    campaignId: 'CAMP-2041',
    isValidated: true,
    acceptanceThreshold: ACCEPTANCE,
    criteria: [
      buildCriterion({ id: 'ko_dec', label: 'Diplôme DEC (expertise comptable)', level: 'redhibitoire' }),
      buildCriterion({ id: 'cap_xp', label: '5+ ans en comptabilité générale', level: 'obligatoire' }),
      buildCriterion({ id: 's_ifrs', label: 'Maîtrise des normes IFRS', level: 'critique', weight: 8 }),
      buildCriterion({ id: 's_sap', label: 'Pratique avérée de SAP', level: 'tres_important', weight: 6 }),
      buildCriterion({ id: 's_eng', label: 'Anglais courant écrit/oral', level: 'important', weight: 4 }),
      buildCriterion({ id: 's_big4', label: 'Expérience en cabinet Big 4', level: 'souhaitable', weight: 2 }),
    ],
  };
}

/** Fiche « Dév backend » frontière : SOFT [7,6,6,6] (den 25) pour viser 74/76. */
function devBackendFrontierSheet(): ScoringSheet {
  return {
    campaignId: 'CAMP-2055',
    isValidated: true,
    acceptanceThreshold: ACCEPTANCE,
    criteria: [
      buildCriterion({ id: 'ko_dipl', label: 'Diplôme Bac+5 informatique', level: 'redhibitoire' }),
      buildCriterion({ id: 'cap_xp', label: '3+ ans de développement backend', level: 'obligatoire' }),
      buildCriterion({ id: 'b_go', label: 'Maîtrise de Go', level: 'critique', weight: 7 }),
      buildCriterion({ id: 'b_sql', label: 'Modélisation SQL avancée', level: 'tres_important', weight: 6 }),
      buildCriterion({ id: 'b_k8s', label: 'Kubernetes en production', level: 'important', weight: 6 }),
      buildCriterion({ id: 'b_ddd', label: 'Domain-Driven Design', level: 'souhaitable', weight: 6 }),
    ],
  };
}

function v(
  criterionId: string,
  llmDecision: LlmCriterionVerdict['llmDecision'],
  llmJustification: string,
  llmCVQuote = '',
  extra: Partial<LlmCriterionVerdict> = {},
): LlmCriterionVerdict {
  return { criterionId, llmDecision, llmJustification, llmCVQuote, ...extra };
}

export const CV_SAMPLE_FIXTURES: CVSampleFixture[] = [
  // ── 01 — accepted franc (≥ 85) ──────────────────────────────────────────
  {
    meta: {
      name: '01-senior-fort-accepte',
      description: 'Comptable senior solide, tous critères clés démontrés. Accepté franc.',
      expectedC4Range: [93, 97],
    },
    cvText:
      "Marie Lefèvre — Expert-comptable diplômée (DEC, 2014). 9 ans en comptabilité " +
      "générale dont 4 en cabinet Big 4 (EY). Clôtures mensuelles, consolidation, " +
      "normes IFRS au quotidien. SAP FI/CO. Anglais courant (TOEIC 945). marie.lefevre@mail.com",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC mentionné (2014).', 'Expert-comptable diplômée (DEC, 2014)'),
      v('cap_xp', 'satisfait', '9 ans en compta générale.', '9 ans en comptabilité générale'),
      v('s_ifrs', 'satisfait', 'IFRS au quotidien.', 'normes IFRS au quotidien'),
      v('s_sap', 'satisfait', 'SAP FI/CO.', 'SAP FI/CO'),
      v('s_eng', 'satisfait', 'Anglais courant, TOEIC 945.', 'Anglais courant (TOEIC 945)'),
      v('s_big4', 'partiel', 'Big 4 (EY) mais durée limitée.', '4 en cabinet Big 4 (EY)'),
    ],
    expectedScoreResult: { totalScore: 95, status: 'accepted', hardFailures: [] },
  },

  // ── 02 — accepted serré (75–85) ─────────────────────────────────────────
  {
    meta: {
      name: '02-senior-correct-accepte',
      description: 'Profil correct, anglais absent mais reste au-dessus du seuil.',
      expectedC4Range: [78, 82],
    },
    cvText:
      "Karim Benali — DSCG puis DEC (2017). 6 ans en comptabilité générale. IFRS et " +
      "consolidation maîtrisées. SAP. Pas d'élément sur l'anglais. Stage initial chez Deloitte.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC 2017.', 'DEC (2017)'),
      v('cap_xp', 'satisfait', '6 ans compta générale.', '6 ans en comptabilité générale'),
      v('s_ifrs', 'satisfait', 'IFRS maîtrisées.', 'IFRS et consolidation maîtrisées'),
      v('s_sap', 'satisfait', 'SAP cité.', 'SAP'),
      v('s_eng', 'non', "Aucun élément sur l'anglais.", ''),
      v('s_big4', 'satisfait', 'Stage chez Deloitte (Big 4).', 'Stage initial chez Deloitte'),
    ],
    expectedScoreResult: { totalScore: 80, status: 'accepted', hardFailures: [] },
  },

  // ── 03 — rejected : score bas franc ─────────────────────────────────────
  {
    meta: {
      name: '03-profil-faible-rejete',
      description: 'Compétences clés peu démontrées. Score bas franc, rejeté par le seuil.',
      expectedC4Range: [13, 17],
    },
    cvText:
      "Léa Dubois — DEC obtenu (2019). 5 ans en cabinet. Découverte de SAP sur un projet. " +
      "Peu d'exposition IFRS, anglais scolaire. Pas de Big 4.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC obtenu.', 'DEC obtenu (2019)'),
      v('cap_xp', 'satisfait', '5 ans en cabinet.', '5 ans en cabinet'),
      v('s_ifrs', 'non', "Peu d'exposition IFRS.", "Peu d'exposition IFRS"),
      v('s_sap', 'partiel', 'Découverte de SAP sur un projet.', 'Découverte de SAP sur un projet'),
      v('s_eng', 'non', 'Anglais scolaire.', 'anglais scolaire'),
      v('s_big4', 'non', 'Pas de Big 4.', 'Pas de Big 4'),
    ],
    expectedScoreResult: { totalScore: 15, status: 'rejected', hardFailures: [] },
  },

  // ── 04 — rejected : HARD_CAP non satisfait (cap) ────────────────────────
  {
    meta: {
      name: '04-experience-insuffisante-cap',
      description: 'Profil techniquement excellent mais expérience requise non atteinte → cap.',
      expectedC4Range: [72, 76],
    },
    cvText:
      "Tom Garnier — DEC (2022). 2 ans d'expérience en comptabilité générale seulement. " +
      "Excellente maîtrise IFRS, SAP, anglais courant, passage par KPMG.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC 2022.', 'DEC (2022)'),
      v('cap_xp', 'non', '2 ans seulement, < 5 ans requis.', "2 ans d'expérience en comptabilité générale seulement"),
      v('s_ifrs', 'satisfait', 'Excellente maîtrise IFRS.', 'Excellente maîtrise IFRS'),
      v('s_sap', 'satisfait', 'SAP.', 'SAP'),
      v('s_eng', 'satisfait', 'Anglais courant.', 'anglais courant'),
      v('s_big4', 'satisfait', 'Passage par KPMG (Big 4).', 'passage par KPMG'),
    ],
    expectedScoreResult: {
      totalScore: 74,
      status: 'rejected',
      hardFailures: [
        { criterionId: 'cap_xp', criterionLabel: '5+ ans en comptabilité générale', criticityLevel: 'obligatoire', reason: 'unsatisfied' },
      ],
    },
  },

  // ── 05 — rejected : HARD_CAP non vérifiable (cap) ───────────────────────
  {
    meta: {
      name: '05-anciennete-non-verifiable-cap',
      description: "Ancienneté non datée dans le CV → HARD_CAP non vérifiable → cap.",
      expectedC4Range: [72, 76],
    },
    cvText:
      "Sofia Moreau — DEC. Expérience en comptabilité générale (durée non précisée). " +
      "IFRS et SAP solides, notions d'anglais. Pas de cabinet Big 4.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC mentionné.', 'DEC'),
      v('cap_xp', 'non_verifiable', 'Durée non précisée, impossible de vérifier les 5 ans.', 'durée non précisée'),
      v('s_ifrs', 'satisfait', 'IFRS solides.', 'IFRS et SAP solides'),
      v('s_sap', 'satisfait', 'SAP solide.', 'IFRS et SAP solides'),
      v('s_eng', 'partiel', "Notions d'anglais.", "notions d'anglais"),
      v('s_big4', 'non', 'Pas de Big 4.', 'Pas de cabinet Big 4'),
    ],
    expectedScoreResult: {
      totalScore: 74,
      status: 'rejected',
      hardFailures: [
        { criterionId: 'cap_xp', criterionLabel: '5+ ans en comptabilité générale', criticityLevel: 'obligatoire', reason: 'unverifiable' },
      ],
    },
  },

  // ── 06 — rejected : HARD_KNOCKOUT non satisfait (score conservé) ────────
  {
    meta: {
      name: '06-diplome-absent-knockout',
      description: 'Excellent profil MAIS pas de DEC → knockout. Score réel élevé conservé.',
      expectedC4Range: [88, 92],
    },
    cvText:
      "Hugo Renard — Master CCA (pas le DEC). 8 ans en comptabilité générale, IFRS, SAP, " +
      "anglais courant. Profil très solide mais diplôme d'expertise comptable non obtenu.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'non', "Master CCA, pas le DEC requis.", "Master CCA (pas le DEC)"),
      v('cap_xp', 'satisfait', '8 ans compta générale.', '8 ans en comptabilité générale'),
      v('s_ifrs', 'satisfait', 'IFRS.', 'IFRS'),
      v('s_sap', 'satisfait', 'SAP.', 'SAP'),
      v('s_eng', 'satisfait', 'Anglais courant.', 'anglais courant'),
      v('s_big4', 'non', 'Pas de Big 4 mentionné.', ''),
    ],
    expectedScoreResult: {
      totalScore: 90,
      status: 'rejected',
      hardFailures: [
        { criterionId: 'ko_dec', criterionLabel: 'Diplôme DEC (expertise comptable)', criticityLevel: 'redhibitoire', reason: 'unsatisfied' },
      ],
    },
  },

  // ── 07 — rejected : HARD_KNOCKOUT non vérifiable (score conservé) ───────
  {
    meta: {
      name: '07-diplome-non-verifiable-knockout',
      description: "Diplôme non mentionné → knockout non vérifiable. Score réel conservé.",
      expectedC4Range: [83, 87],
    },
    cvText:
      "Nadia Cherif — 7 ans en comptabilité générale, IFRS, SAP (en montée en compétence), " +
      "anglais courant, ex-PwC. Le CV ne mentionne aucun diplôme.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'non_verifiable', "Aucun diplôme mentionné dans le CV.", 'Le CV ne mentionne aucun diplôme'),
      v('cap_xp', 'satisfait', '7 ans compta générale.', '7 ans en comptabilité générale'),
      v('s_ifrs', 'satisfait', 'IFRS.', 'IFRS'),
      v('s_sap', 'partiel', 'SAP en montée en compétence.', 'SAP (en montée en compétence)'),
      v('s_eng', 'satisfait', 'Anglais courant.', 'anglais courant'),
      v('s_big4', 'satisfait', 'Ex-PwC (Big 4).', 'ex-PwC'),
    ],
    expectedScoreResult: {
      totalScore: 85,
      status: 'rejected',
      hardFailures: [
        { criterionId: 'ko_dec', criterionLabel: 'Diplôme DEC (expertise comptable)', criticityLevel: 'redhibitoire', reason: 'unverifiable' },
      ],
    },
  },

  // ── 08 — rejected : CV laconique (mous non vérifiables) ─────────────────
  {
    meta: {
      name: '08-cv-laconique-score-bas',
      description: 'CV très court : durs OK mais aucun signal sur les compétences → score 0.',
      expectedC4Range: [0, 4],
    },
    cvText:
      "Paul Martin — Expert-comptable (DEC). 6 ans d'expérience en comptabilité générale. " +
      "Disponible immédiatement.",
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'satisfait', 'DEC.', 'Expert-comptable (DEC)'),
      v('cap_xp', 'satisfait', '6 ans compta générale.', "6 ans d'expérience en comptabilité générale"),
      v('s_ifrs', 'non_verifiable', 'Rien sur IFRS.', ''),
      v('s_sap', 'non_verifiable', 'Rien sur SAP.', ''),
      v('s_eng', 'non_verifiable', "Rien sur l'anglais.", ''),
      v('s_big4', 'non_verifiable', 'Rien sur le parcours cabinet.', ''),
    ],
    expectedScoreResult: { totalScore: 0, status: 'rejected', hardFailures: [] },
  },

  // ── 09 — accepted : frontière juste au-dessus du seuil (76) ─────────────
  {
    meta: {
      name: '09-frontiere-juste-au-dessus',
      description: 'Dév backend pile au-dessus du seuil (76 ≥ 75). Valide le comportement de seuil.',
      expectedC4Range: [74, 78],
    },
    cvText:
      "Inès Faure — Master informatique. 4 ans de backend. Go solide, SQL avancé, " +
      "premières mises en prod sur Kubernetes, sensibilisée au DDD.",
    scoringSheet: devBackendFrontierSheet(),
    decisions: [
      v('ko_dipl', 'satisfait', 'Master informatique.', 'Master informatique'),
      v('cap_xp', 'satisfait', '4 ans de backend.', '4 ans de backend'),
      v('b_go', 'satisfait', 'Go solide.', 'Go solide'),
      v('b_sql', 'satisfait', 'SQL avancé.', 'SQL avancé'),
      v('b_k8s', 'partiel', 'Premières mises en prod K8s.', 'premières mises en prod sur Kubernetes'),
      v('b_ddd', 'partiel', 'Sensibilisée au DDD.', 'sensibilisée au DDD'),
    ],
    expectedScoreResult: { totalScore: 76, status: 'accepted', hardFailures: [] },
  },

  // ── 10 — rejected : CV pathologique (illisible / tout non vérifiable) ───
  {
    meta: {
      name: '10-cv-pathologique-illisible',
      description: 'CV mal formaté/illisible : rien d’extractable → knockout + cap, score 0.',
      expectedC4Range: [0, 2],
    },
    cvText: '���  PDF scanné illisible — aucun texte exploitable  ���',
    scoringSheet: comptableSeniorSheet(),
    decisions: [
      v('ko_dec', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
      v('cap_xp', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
      v('s_ifrs', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
      v('s_sap', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
      v('s_eng', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
      v('s_big4', 'non_verifiable', 'CV illisible.', '', { llmFailure: true }),
    ],
    expectedScoreResult: {
      totalScore: 0,
      status: 'rejected',
      hardFailures: [
        { criterionId: 'ko_dec', criterionLabel: 'Diplôme DEC (expertise comptable)', criticityLevel: 'redhibitoire', reason: 'unverifiable' },
        { criterionId: 'cap_xp', criterionLabel: '5+ ans en comptabilité générale', criticityLevel: 'obligatoire', reason: 'unverifiable' },
      ],
    },
  },
];
