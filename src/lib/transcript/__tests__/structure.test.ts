import { describe, expect, it } from 'vitest';

import { normalizeTranscript } from '@/lib/transcript/normalize';
import {
  checkAndRender,
  comparable,
  isEvaluative,
  StructuringOutputSchema,
  type StructuringOutput,
} from '@/lib/transcript/structure';

const transcript = normalizeTranscript(
  [
    'Sami Benali  0:03',
    'Parlez-moi de votre dernier poste, et de la recette en particulier.',
    '',
    'Jean Dupont  0:10',
    'J’ai piloté la recette de bout en bout sur un projet de paiements instantanés.',
    'Je souhaite rejoindre une équipe produit dans les six mois.',
  ].join('\n'),
);

const item = (text: string, quote: string) => ({ text, quote, speaker: 'Jean Dupont', at: '00:00:10' });

function output(over: Partial<StructuringOutput> = {}): StructuringOutput {
  return {
    topics: [],
    criteria: [],
    highlights: [],
    reservations: [],
    followUps: [],
    omittedCount: 0,
    ...over,
  };
}

describe('schéma de sortie — aucun endroit pour un score ou un avis', () => {
  it('un champ en plus est REFUSÉ', () => {
    expect(StructuringOutputSchema.safeParse({ ...output(), score: 72 }).success).toBe(false);
    expect(
      StructuringOutputSchema.safeParse({
        ...output(),
        topics: [{ ...item('x', 'y'), verdict: 'go' }],
      }).success,
    ).toBe(false);
  });
});

describe('citations vérifiées mot pour mot', () => {
  it('retrouvée (apostrophe typographique, casse, guillemets) : gardée et attribuée', () => {
    const r = checkAndRender(
      output({ highlights: [item('A piloté une recette complète.', '« j\'ai piloté la recette de bout en bout »')] }),
      transcript,
      [],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats).toMatchObject({ kept: 1, removedUnproven: 0 });
    expect(r.sections.body).toBe(
      'Ce que le candidat a mis en avant\n- A piloté une recette complète. — « j\'ai piloté la recette de bout en bout » (Jean Dupont, 00:00:10)',
    );
  });

  it('inventée : RETIRÉE et comptée', () => {
    const r = checkAndRender(
      output({ highlights: [item('Maîtrise SQL.', 'je fais du SQL tous les jours depuis dix ans')] }),
      transcript,
      [],
    );
    expect(r.ok && r.stats.removedUnproven).toBe(1);
    expect(r.ok && r.sections.body).toBe('');
  });

  it('trop courte pour prouver (« oui ») : retirée', () => {
    const r = checkAndRender(output({ topics: [item('Accord.', 'Je')] }), transcript, []);
    expect(r.ok && r.stats.removedUnproven).toBe(1);
  });
});

describe('le compte rendu ne juge pas', () => {
  it.each([
    'Profil idéal pour le poste.',
    'Note de 8/10 sur la recette.',
    'Je recommande de le retenir.',
    'Candidat solide.',
  ])('« %s » : signalé, pas supprimé', (text) => {
    expect(isEvaluative(text)).toBe(true);
    const r = checkAndRender(
      output({ highlights: [item(text, 'piloté la recette de bout en bout')] }),
      transcript,
      [],
    );
    expect(r.ok && r.stats.flagged).toBe(1);
    expect(r.ok && r.sections.body).toMatch(/\n- \[formulation à vérifier\] /u);
  });

  it('une restitution neutre n’est pas signalée', () => {
    expect(isEvaluative('Le candidat indique avoir piloté la recette.')).toBe(false);
  });
});

describe('critères de la campagne', () => {
  const criteria = [
    { criterionId: 'c1', label: 'Pilotage de recette' },
    { criterionId: 'c2', label: 'Anglais courant' },
  ];

  it('abordé / non abordé — jamais « non satisfait » ; identifiant inventé ignoré', () => {
    const r = checkAndRender(
      output({
        criteria: [
          { criterionId: 'c1', addressed: true, items: [item('Recette pilotée.', 'piloté la recette de bout en bout')] },
          { criterionId: 'inventé', addressed: true, items: [] },
        ],
      }),
      transcript,
      criteria,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sections.body).toBe(
      [
        'Réponses aux critères de la campagne',
        '• Pilotage de recette',
        '- Recette pilotée. — « piloté la recette de bout en bout » (Jean Dupont, 00:00:10)',
        '• Anglais courant',
        'Non abordé pendant l’entretien.',
      ].join('\n'),
    );
    expect(r.sections.body).not.toMatch(/inventé|non satisfait|insuffisant/iu);
  });
});

describe('plafond : pas une transcription déguisée', () => {
  it('au-delà du budget de citations : proposition REFUSÉE', () => {
    const long = normalizeTranscript(`Jean : ${'la recette et les paiements instantanés '.repeat(60)}`);
    const quote = 'la recette et les paiements instantanés '.repeat(4).trim();
    const items = Array.from({ length: 6 }, () => item('Recette.', quote));
    expect(checkAndRender(output({ topics: items }), long, [])).toEqual({ ok: false, reason: 'too_much_quoted' });
  });
});

describe('comparable', () => {
  it('unifie apostrophes, guillemets, casse, espaces et ponctuation de bord', () => {
    expect(comparable('  « J’ai  piloté… »  ')).toBe("j'ai piloté");
  });
});
