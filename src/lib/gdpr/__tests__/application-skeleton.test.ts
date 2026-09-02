/**
 * Le squelette d'analyse conservé après effacement.
 *
 * L'exhaustivité champ par champ est déjà tenue PAR LE COMPILATEUR (les
 * `Record<keyof T, Disposition>` refusent de compiler si un champ manque). Ce
 * que ces tests ajoutent, et que le typage ne peut pas faire : vérifier que la
 * DÉCLARATION correspond à ce que le code FAIT. Une table qui dit « erase » et
 * un code qui recopie la valeur compileraient parfaitement.
 */
import { describe, expect, it } from 'vitest';

import {
  DISPOSITION_CANDIDATE,
  DISPOSITION_CRITERION,
  DISPOSITION_NARRATION,
  DISPOSITION_SCORE,
  isApplicationStripped,
  stripApplication,
} from '@/lib/gdpr/application-skeleton';
import { CVApplicationSchema, type CVApplication } from '@/types/cv-analysis';

const MARKER = '[effacé — demande RGPD test]';

function fixture(): CVApplication {
  return {
    candidate: {
      fullName: 'Jean Dupont',
      email: 'jean.dupont@exemple.fr',
      phone: '+33 6 12 34 56 78',
      detectedLanguage: 'fr',
      fileName: 'CV-Jean-Dupont.pdf',
      source: 'email',
      receivedAt: '2026-07-14T09:12:00.000Z',
      rightToWork: true,
      location: 'Lyon',
      photoPresent: true,
    },
    scoringResult: {
      totalScore: 72,
      status: 'accepted',
      decisionZone: 'gray',
      breakdown: [
        {
          criterionId: 'c1',
          criterionLabel: 'Consultant MOA',
          criticityLevel: 'important',
          weight: 30,
          behavior: 'SOFT_WEIGHTED',
          llmDecision: 'satisfait',
          llmJustification: 'Jean Dupont a piloté trois projets MOA chez Acme.',
          llmCVQuote: 'Consultant SI & AMOA — Acme, 2019-2024',
          contribution: 30,
          verificationMethodUsed: 'llm_with_quote',
          matchedKeywords: ['AMOA'],
          decidedBy: 'llm',
        },
      ],
      hardFailures: [],
      criteriaVersion: 'v3',
      computedAt: '2026-07-14T09:13:00.000Z',
    },
    narration: {
      summary: 'Jean Dupont, consultant AMOA de 8 ans d’expérience.',
      strengths: ['Trade Finance'],
      weaknesses: ['Peu d’anglais'],
      justification: 'Profil cohérent avec le poste.',
    },
  };
}

describe('stripApplication', () => {
  it('rend un objet qui reste VALIDE au regard du schéma', () => {
    // Sinon l'audit planterait au parsing au lieu d'afficher un dossier
    // neutralisé — un effacement ne doit pas casser l'écran qui le montre.
    const out = stripApplication(fixture(), MARKER);
    expect(() => CVApplicationSchema.parse(out)).not.toThrow();
  });

  it('détruit les citations littérales du CV et la narration', () => {
    const out = stripApplication(fixture(), MARKER);
    const blob = JSON.stringify(out);
    expect(blob).not.toContain('Consultant SI & AMOA');
    expect(blob).not.toContain('Acme');
    expect(blob).not.toContain('Trade Finance');
    expect(blob).not.toContain('Peu d’anglais');
    expect(out.scoringResult.breakdown[0]!.llmCVQuote).toBe('');
    expect(out.narration.strengths).toEqual([]);
  });

  it('ne laisse aucune coordonnée', () => {
    const out = stripApplication(fixture(), MARKER);
    const blob = JSON.stringify(out);
    expect(blob).not.toContain('jean.dupont@exemple.fr');
    expect(blob).not.toContain('12 34 56 78');
    expect(blob).not.toContain('Jean Dupont');
    expect(blob).not.toContain('Lyon');
  });

  it('conserve ce qui alimente les compteurs des bilans', () => {
    const before = fixture();
    const out = stripApplication(before, MARKER);
    expect(out.scoringResult.totalScore).toBe(72);
    expect(out.scoringResult.status).toBe('accepted');
    expect(out.scoringResult.decisionZone).toBe('gray');
    expect(out.candidate.source).toBe('email');
    expect(out.candidate.receivedAt).toBe(before.candidate.receivedAt);
    expect(out.scoringResult.breakdown[0]!.criterionLabel).toBe('Consultant MOA');
    expect(out.scoringResult.breakdown[0]!.llmDecision).toBe('satisfait');
  });

  it('ne laisse pas `matchedKeywords` à `[]` — `[]` affirmerait un fait faux', () => {
    // Dans ce modèle, `[]` signifie « cherché, rien trouvé ». Après effacement
    // on ne sait plus : `undefined` (« non applicable ») est la seule valeur
    // honnête.
    const out = stripApplication(fixture(), MARKER);
    expect(out.scoringResult.breakdown[0]!.matchedKeywords).toBeUndefined();
  });

  it('est idempotent — un rejeu ne change rien', () => {
    const once = stripApplication(fixture(), MARKER);
    const twice = stripApplication(once, MARKER);
    expect(twice).toEqual(once);
    expect(isApplicationStripped(once)).toBe(true);
    expect(isApplicationStripped(fixture())).toBe(false);
  });
});

describe('la déclaration correspond au code', () => {
  // Le compilateur garantit que la table est EXHAUSTIVE ; ces tests
  // garantissent qu'elle est SINCÈRE.
  const before = fixture();
  const after = stripApplication(before, MARKER);

  it('candidat', () => {
    for (const [key, disposition] of Object.entries(DISPOSITION_CANDIDATE)) {
      const k = key as keyof typeof before.candidate;
      if (disposition === 'keep') expect(after.candidate[k]).toEqual(before.candidate[k]);
      if (disposition === 'marker') expect(after.candidate[k]).toBe(MARKER);
      if (disposition === 'erase') {
        expect([null, '', false, undefined]).toContainEqual(after.candidate[k]);
      }
    }
  });

  it('résultat de scoring', () => {
    for (const [key, disposition] of Object.entries(DISPOSITION_SCORE)) {
      if (disposition !== 'keep') continue;
      const k = key as keyof typeof before.scoringResult;
      if (k === 'breakdown' || k === 'hardFailures') continue; // conteneurs
      expect(after.scoringResult[k]).toEqual(before.scoringResult[k]);
    }
  });

  it('décision par critère', () => {
    const b0 = before.scoringResult.breakdown[0]!;
    const a0 = after.scoringResult.breakdown[0]!;
    for (const [key, disposition] of Object.entries(DISPOSITION_CRITERION)) {
      const k = key as keyof typeof b0;
      if (disposition === 'keep') expect(a0[k]).toEqual(b0[k]);
      if (disposition === 'marker') expect(a0[k]).toBe(MARKER);
      if (disposition === 'erase') expect([undefined, '', null]).toContainEqual(a0[k]);
    }
  });

  it('narration', () => {
    for (const [key, disposition] of Object.entries(DISPOSITION_NARRATION)) {
      const k = key as keyof typeof after.narration;
      if (disposition === 'marker') expect(after.narration[k]).toBe(MARKER);
      if (disposition === 'erase') expect(after.narration[k]).toEqual([]);
    }
  });
});
