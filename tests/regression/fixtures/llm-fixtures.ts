/**
 * Fixtures LLM FIXES de la suite de régression — versionnées avec les tests.
 *
 * Le mock du provider (helpers/mocks.ts) route chaque appel sur une sous-chaîne
 * du prompt SYSTÈME, puis sélectionne le PROFIL par un marqueur présent dans le
 * texte du CV fixture (prompt utilisateur) :
 *   - PROFIL_FORT_TREG   → tous les critères satisfaits  → auto_accept attendu
 *   - PROFIL_FAIBLE_TREG → tout « non » (rédhibitoire KO) → auto_reject attendu
 *   - PROFIL_MOYEN_TREG  → mitigé                         → zone grise attendue
 *
 * ⚠️ Contrainte structurelle : les verdicts sont indexés par NUMÉRO D'ORDRE
 * ("1".."N") des critères LLM de la fiche — ces fixtures sont donc écrites pour
 * LA fiche canonique de test (4 critères, tous `llm_with_quote`, cf.
 * helpers/api.ts `testScoringSheet`). Changer la fiche ⇒ changer les verdicts.
 */

export type TestProfile = 'fort' | 'faible' | 'moyen';

export const PROFILE_MARKERS: Record<TestProfile, string> = {
  fort: 'PROFIL_FORT_TREG',
  faible: 'PROFIL_FAIBLE_TREG',
  moyen: 'PROFIL_MOYEN_TREG',
};

export function profileFromText(text: string): TestProfile | null {
  for (const [profile, marker] of Object.entries(PROFILE_MARKERS)) {
    if (text.includes(marker)) return profile as TestProfile;
  }
  return null;
}

/** Identités fixes par profil (emails marqués @test.local → clean idempotent). */
export const PROFILE_IDENTITY: Record<
  TestProfile,
  { fullName: string; email: string; title: string }
> = {
  fort: {
    fullName: 'Victor Fort',
    email: 'fort@test.local',
    title: 'Testeur Logiciel TREG',
  },
  faible: {
    fullName: 'Fabien Faible',
    email: 'faible@test.local',
    title: 'Comptable TREG',
  },
  moyen: {
    fullName: 'Marc Moyen',
    email: 'moyen@test.local',
    title: 'Analyste TREG',
  },
};

/** Extraction candidat (ExtractedCandidateSchema, .strict()). */
export function candidateExtractionFixture(profile: TestProfile) {
  const id = PROFILE_IDENTITY[profile];
  return {
    isCv: true,
    fullName: id.fullName,
    email: id.email,
    phone: '0600000001',
    detectedLanguage: 'fr',
    rightToWork: null,
    location: 'Paris',
    photoPresent: false,
  };
}

/** Relevé de faits (CVFactLedgerSchema) — commun, purement factuel. */
export const LEDGER_FIXTURE = {
  yearsExperience: 6,
  tools: ['TREGSKILL', 'SQL'],
  methodologies: ['Agile'],
  skills: ['automatisation des tests'],
  domains: ['test logiciel'],
};

/**
 * Verdicts (VerdictsResponseSchema) — criterionId = NUMÉRO d'ordre des critères
 * LLM de la fiche canonique (4 critères : rédhibitoire, critique 8,
 * très important 6, important 4).
 *   fort   : 4× satisfait          → score 100
 *   faible : 4× non                → knockout rédhibitoire, score 0
 *   moyen  : satisfait, satisfait, non, non → ~44 (8/18), entre les poignées
 */
const VERDICT_PATTERNS: Record<TestProfile, string[]> = {
  fort: ['satisfait', 'satisfait', 'satisfait', 'satisfait'],
  faible: ['non', 'non', 'non', 'non'],
  moyen: ['satisfait', 'satisfait', 'non', 'non'],
};

export function verdictsFixture(profile: TestProfile) {
  return {
    verdicts: VERDICT_PATTERNS[profile].map((decision, i) => ({
      criterionId: String(i + 1),
      llmDecision: decision,
      llmJustification: `Verdict fixe de test (${profile}, critère ${i + 1}).`,
      llmCVQuote: decision === 'non' ? '' : 'Extrait fixe du CV de test.',
    })),
  };
}

/** Narration (CVNarrationSchema) — cosmétique, commune. */
export const NARRATION_FIXTURE = {
  summary: 'Synthese fixe de test (suite de regression).',
  strengths: ['Point fort fixe de test.'],
  weaknesses: ['Point de vigilance fixe de test.'],
  justification: 'Justification fixe de test, alignee sur le verdict calcule.',
};

/** Entités vivier (VivierExtractionSchema) — titre = clé de la présélection S5. */
export function vivierEntitiesFixture(profile: TestProfile) {
  const id = PROFILE_IDENTITY[profile];
  return {
    technologies: ['TREGSKILL', 'SQL'],
    certifications: [],
    diplomes: ['Master Informatique'],
    secteurs: ['test logiciel'],
    langues: ['francais', 'anglais'],
    experienceYears: 6,
    localisation: 'Paris',
    title: id.title,
    skills: ['tregskill', 'sql'],
    recentPositions: [id.title],
  };
}

/** Variantes de titre (TitleVariantsResponseSchema) — aucune : match exact voulu. */
export const TITLE_VARIANTS_FIXTURE = { variants: [] };

/** Trame d'entretien (InterviewGuideSchema — via chatComplete, parse manuel). */
export const INTERVIEW_GUIDE_FIXTURE = {
  questions: Array.from({ length: 7 }, (_, i) => ({
    theme: `Theme ${i + 1}`,
    question: `Question fixe de test numero ${i + 1} pour la trame d'entretien.`,
  })),
};
