import { describe, expect, it } from 'vitest';

import {
  computeSkillCoverage,
  cosineSimilarity,
  type SkillVector,
} from '@/lib/vivier/skill-coverage';

// Vecteurs jouets orthonormés : chaque « compétence » = un axe canonique, on
// contrôle ainsi exactement les similarités (1 si identique, 0 si orthogonal).
function axis(i: number, dim = 6): number[] {
  const v = new Array(dim).fill(0);
  v[i] = 1;
  return v;
}
function skill(term: string, i: number, dim = 6): SkillVector {
  return { term, vector: axis(i, dim) };
}

describe('cosineSimilarity', () => {
  it('identiques ⇒ 1, orthogonaux ⇒ 0', () => {
    expect(cosineSimilarity(axis(0), axis(0))).toBeCloseTo(1);
    expect(cosineSimilarity(axis(0), axis(1))).toBeCloseTo(0);
  });
  it('norme nulle ou tailles différentes ⇒ 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 1])).toBe(0);
  });
});

describe('computeSkillCoverage — set-to-set', () => {
  it('asymétrie 5 vs 20 : un CV pointu couvre ses attentes sans pénalité de volume', () => {
    // Fiche : 5 compétences attendues (axes 0..4). Candidat : 20 compétences
    // (axes 0..4 pertinents + 15 « bruit » sur d'autres axes — ici on simule en
    // ré-utilisant les mêmes axes, le max par attente reste 1).
    const jobSkills = [0, 1, 2, 3, 4].map((i) => skill(`job-${i}`, i));
    const candidateSkills = [0, 1, 2, 3, 4].map((i) => skill(`cv-${i}`, i));
    const r = computeSkillCoverage({ jobSkills, candidateSkills, perSkillFloor: 0.8 });
    expect(r.coverage).toBeCloseTo(1);
    expect(r.matches.every((m) => m.covered)).toBe(true);
  });

  it('couverture partielle = proportion d’attentes couvertes', () => {
    const jobSkills = [0, 1, 2, 3].map((i) => skill(`job-${i}`, i, 8));
    // Le candidat ne couvre que 0 et 2.
    const candidateSkills = [skill('cv-0', 0, 8), skill('cv-2', 2, 8)];
    const r = computeSkillCoverage({ jobSkills, candidateSkills, perSkillFloor: 0.8 });
    expect(r.coverage).toBeCloseTo(0.5);
    const covered = r.matches.filter((m) => m.covered).map((m) => m.jobSkill);
    expect(covered).toEqual(['job-0', 'job-2']);
  });

  it('mapping interprétable : chaque attente pointe la compétence CV retenue', () => {
    const jobSkills = [skill('Python', 0)];
    const candidateSkills = [skill('Python (avancé)', 0), skill('Java', 1)];
    const r = computeSkillCoverage({ jobSkills, candidateSkills, perSkillFloor: 0.8 });
    expect(r.matches[0]).toMatchObject({
      jobSkill: 'Python',
      candidateSkill: 'Python (avancé)',
      covered: true,
    });
  });

  it('candidat sans compétences (pas réindexé) ⇒ coverage 0 (dégradation douce)', () => {
    const jobSkills = [skill('Python', 0), skill('Java', 1)];
    const r = computeSkillCoverage({ jobSkills, candidateSkills: [], perSkillFloor: 0.5 });
    expect(r.coverage).toBe(0);
    expect(r.matches.every((m) => !m.covered && m.similarity === 0)).toBe(true);
  });

  it('fiche sans attentes ⇒ coverage 0 (aucun signal)', () => {
    const r = computeSkillCoverage({
      jobSkills: [],
      candidateSkills: [skill('Python', 0)],
      perSkillFloor: 0.5,
    });
    expect(r).toEqual({ coverage: 0, matches: [] });
  });

  it('seuil par compétence : sous le seuil ⇒ non couvert', () => {
    // Deux axes distincts ⇒ similarité 0 < seuil.
    const r = computeSkillCoverage({
      jobSkills: [skill('Python', 0)],
      candidateSkills: [skill('Comptabilité', 1)],
      perSkillFloor: 0.5,
    });
    expect(r.coverage).toBe(0);
    expect(r.matches[0]!.covered).toBe(false);
  });
});
