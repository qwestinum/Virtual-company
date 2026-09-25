/**
 * « Aucun oui sans preuve » — la garde symétrique de `verdict-integrity`.
 *
 * Les trois cas de bascule de la comparaison de modèles du 25/09/2026 sont
 * reproduits sur un CV SYNTHÉTIQUE, avec la même structure de verdicts (même
 * nombre de critères, mêmes niveaux, même nature de citation : exacte ou à un
 * mot près). Aucun contenu de CV réel dans le dépôt.
 *
 * ⚠️ Ce que ces trois cas MONTRENT, et qu'on ne maquille pas : la garde ne
 * rattrape qu'UN des sept critères surclassés par gpt-4o-mini. Les six autres
 * s'appuient sur une ligne RÉELLE du CV, sur-interprétée — un défaut de
 * pertinence, qu'aucun contrôle de chaîne ne peut voir.
 */
import { describe, expect, it } from 'vitest';

import { enforceQuotedEvidence, quoteFoundInCv, scoreCandidat, type LlmCriterionVerdict } from '@/lib/scoring';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

const CV = [
  'Consultante fonctionnelle — 6 ans',
  'Conception de parcours clients sur une application bancaire mobile.',
  'Animation d’ateliers avec les métiers et arbitrage des priorités.',
  'Rédaction des spécifications fonctionnelles détaillées.',
  'Veille sur les usages de l’IA générative (ChatGPT, Copilot).',
  'Anglais courant.',
].join('\n');

const llm = (
  criterionId: string,
  llmDecision: LlmCriterionVerdict['llmDecision'],
  llmCVQuote: string,
): LlmCriterionVerdict => ({ criterionId, llmDecision, llmJustification: `Verdict ${llmDecision}.`, llmCVQuote, decidedBy: 'llm' });

describe('citation retrouvée dans le CV', () => {
  it('ligatures, espaces, casse, ponctuation de bord : pas des écarts', () => {
    expect(quoteFoundInCv('conception de parcours clients sur une application bancaire mobile.', CV)).toBe(true);
    expect(quoteFoundInCv('- Rédaction des spéciﬁcations fonctionnelles détaillées', CV)).toBe(true);
    expect(quoteFoundInCv('Anglais   courant', CV)).toBe(true);
  });
  it('un mot changé, deux lignes NON voisines recollées : des écarts', () => {
    expect(quoteFoundInCv('Conception de parcours utilisateurs sur une application bancaire mobile', CV)).toBe(false);
    expect(quoteFoundInCv('Rédaction des spécifications fonctionnelles détaillées. Anglais courant', CV)).toBe(false);
    // Deux lignes VOISINES, c'est un passage continu du CV : recevable.
    expect(quoteFoundInCv('Rédaction des spécifications fonctionnelles détaillées. Veille sur les usages', CV)).toBe(true);
    // Deux passages distincts séparés par une ellipse, comme le prompt le demande : recevable.
    expect(quoteFoundInCv('Rédaction des spécifications fonctionnelles … Anglais courant', CV)).toBe(true);
  });
});

describe('enforceQuotedEvidence', () => {
  it('satisfait / partiel sans citation, ou citation introuvable ⇒ non_verifiable, et c’est TRACÉ', () => {
    const [a, b, c] = enforceQuotedEvidence(
      [
        llm('a', 'satisfait', ''),
        llm('b', 'partiel', 'Animation d’ateliers avec les utilisateurs'),
        llm('c', 'satisfait', 'Animation d’ateliers avec les métiers'),
      ],
      CV,
    );
    expect(a).toMatchObject({ llmDecision: 'non_verifiable', llmCVQuote: '', evidenceDowngrade: { from: 'satisfait', reason: 'missing_quote' } });
    expect(a!.llmJustification).toMatch(/non retenu : aucune citation/);
    expect(b).toMatchObject({ llmDecision: 'non_verifiable', llmCVQuote: '', evidenceDowngrade: { from: 'partiel', reason: 'quote_not_found' } });
    expect(c).toMatchObject({ llmDecision: 'satisfait' });
    expect(c!.evidenceDowngrade).toBeUndefined();
  });

  it('ne touche ni aux « non » / « non vérifiable », ni aux verdicts déterministes', () => {
    const kept = [
      llm('n', 'non', ''),
      llm('nv', 'non_verifiable', ''),
      { ...llm('kw', 'satisfait', 'citation construite par le code'), decidedBy: 'keyword_match' as const },
      // Verdicts antérieurs au champ `decidedBy` : pas un verdict du modèle ICI.
      { criterionId: 'old', llmDecision: 'satisfait' as const, llmJustification: 'x', llmCVQuote: '' },
    ];
    expect(enforceQuotedEvidence(kept, CV)).toEqual(kept);
  });

  it('sur un RÉDHIBITOIRE, la rétrogradation vaut échec dur ⇒ refus PROPOSÉ (jamais envoyé seul)', () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'ko', label: 'Anglais courant', level: 'redhibitoire' }),
        buildCriterion({ id: 's', label: 'Spécifications', level: 'critique', weight: 8 }),
      ],
    };
    const verdicts = enforceQuotedEvidence(
      [llm('ko', 'satisfait', 'Anglais bilingue'), llm('s', 'satisfait', 'Rédaction des spécifications fonctionnelles détaillées.')],
      CV,
    );
    const r = scoreCandidat(verdicts, sheet, { thresholdLow: 40, thresholdHigh: 70 });
    expect(r.hardFailures.map((f) => f.criterionId)).toEqual(['ko']);
    expect(r.decisionZone).toBe('proposed_reject');
    expect(r.breakdown.find((b) => b.criterionId === 'ko')!.evidenceDowngrade).toEqual({ from: 'satisfait', reason: 'quote_not_found' });
  });
});

describe('les trois bascules du run du 25/09/2026 (structure reproduite, CV synthétique)', () => {
  it('cas 1 (à décider → accepté, +46) : SEUL le critère critique à citation introuvable est rattrapé', () => {
    const out = enforceQuotedEvidence(
      [
        llm('1', 'partiel', 'Veille sur les usages de l’IA générative'), // citation exacte
        llm('2', 'satisfait', 'Conception de parcours utilisateurs sur une application bancaire mobile'), // un mot changé
        llm('3', 'satisfait', 'Animation d’ateliers avec les métiers et arbitrage des priorités.'), // exacte
        llm('4', 'non_verifiable', ''),
        llm('5', 'satisfait', 'Rédaction des spécifications fonctionnelles détaillées.'), // exacte
        llm('6', 'satisfait', 'Animation d’ateliers avec les métiers'), // exacte
      ],
      CV,
    );
    expect(out.map((v) => v.llmDecision)).toEqual(['partiel', 'non_verifiable', 'satisfait', 'non_verifiable', 'satisfait', 'satisfait']);
    expect(out.filter((v) => v.evidenceDowngrade)).toHaveLength(1);
  });

  it('cas 2 (à décider → accepté, +44) : deux citations EXACTES — la garde ne change rien', () => {
    const verdicts = [
      llm('1', 'satisfait', 'Animation d’ateliers avec les métiers et arbitrage des priorités.'),
      llm('2', 'satisfait', 'Conception de parcours clients sur une application bancaire mobile.'),
    ];
    expect(enforceQuotedEvidence(verdicts, CV)).toEqual(verdicts);
  });

  it('cas 3 (à décider → accepté, +19) : citations EXACTES — la garde ne change rien', () => {
    const verdicts = [
      llm('1', 'satisfait', 'Conception de parcours clients sur une application bancaire mobile.'),
      llm('2', 'partiel', 'Veille sur les usages de l’IA générative (ChatGPT, Copilot).'),
    ];
    expect(enforceQuotedEvidence(verdicts, CV)).toEqual(verdicts);
  });
});
