/**
 * Couverture de compétences set-to-set (présélection Vivier — Chantier 3).
 *
 * On NE moyenne PAS les compétences dans un vecteur unique : le barycentre
 * d'un CV à 5 compétences (pointu) vs une fiche à 20 (émoussé) donne une
 * similarité médiocre même en bonne couverture, et favorise les profils
 * génériques au détriment des spécialistes — l'inverse de ce qu'on veut.
 *
 * Mécanique : un embedding PAR compétence des deux côtés. Pour CHAQUE compétence
 * ATTENDUE de la fiche, on cherche sa meilleure correspondance parmi les
 * compétences du candidat (max cosinus). Chaque attente est évaluée
 * indépendamment ⇒ l'asymétrie N vs M cesse d'être pénalisante. Agrégation en
 * TAUX DE COUVERTURE (proportion d'attentes couvertes au-dessus d'un seuil
 * par compétence). Sortie INTERPRÉTABLE : mapping attente → compétence CV.
 *
 * Pur et déterministe (testé). V1 : poids égal par compétence (criticité = V2).
 */

export type SkillVector = {
  /** Libellé lisible de la compétence (affichage / explicabilité). */
  term: string;
  /** Embedding de la compétence (même espace des deux côtés). */
  vector: number[];
};

/** Mapping d'une attente de la fiche vers la meilleure compétence du candidat. */
export type SkillMatch = {
  /** Compétence attendue (fiche). */
  jobSkill: string;
  /** Compétence du candidat retenue (null si rien au-dessus du seuil). */
  candidateSkill: string | null;
  /** Meilleure similarité cosinus trouvée (0 si le candidat n'a aucune compétence). */
  similarity: number;
  /** Vrai si `similarity >= perSkillFloor`. */
  covered: boolean;
};

export type SkillCoverageResult = {
  /** Taux de couverture 0..1 = attentes couvertes / attentes totales. */
  coverage: number;
  /** Détail par attente (explicabilité — affiché en présélection). */
  matches: SkillMatch[];
};

/** Cosinus borné. Vecteur de norme nulle ou tailles incompatibles ⇒ 0. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Couverture des compétences ATTENDUES (fiche) par celles du candidat.
 *
 *   - `jobSkills` vide ⇒ coverage 0 (aucun signal compétences ; en présélection,
 *     un terme nul à poids égal ne réordonne personne).
 *   - `candidateSkills` vide ⇒ toutes les attentes non couvertes ⇒ coverage 0
 *     (candidat pas encore réindexé : dégradation douce vers le titre seul).
 */
export function computeSkillCoverage(input: {
  jobSkills: SkillVector[];
  candidateSkills: SkillVector[];
  perSkillFloor: number;
}): SkillCoverageResult {
  const { jobSkills, candidateSkills, perSkillFloor } = input;
  if (jobSkills.length === 0) return { coverage: 0, matches: [] };

  const matches: SkillMatch[] = jobSkills.map((expected) => {
    let bestSim = 0;
    let bestTerm: string | null = null;
    for (const cs of candidateSkills) {
      const sim = cosineSimilarity(expected.vector, cs.vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestTerm = cs.term;
      }
    }
    const covered = bestTerm !== null && bestSim >= perSkillFloor;
    return {
      jobSkill: expected.term,
      candidateSkill: covered ? bestTerm : null,
      similarity: bestSim,
      covered,
    };
  });

  const coveredCount = matches.filter((m) => m.covered).length;
  return { coverage: coveredCount / jobSkills.length, matches };
}
