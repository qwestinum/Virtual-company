import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NO_AUTOMATIC_REJECTION,
  thresholdZoneHint,
  thresholdZoneLabels,
} from '@/lib/campaign/threshold-labels';

describe('thresholdZoneLabels', () => {
  it('nomme la zone basse par ce qui s’y passe : une PROPOSITION', () => {
    const labels = thresholdZoneLabels(10, 90);
    expect(labels.low).toBe('Proposé au refus < 10');
    expect(labels.middle).toBe('À examiner');
    expect(labels.high).toBe('Accept. auto ≥ 90');
  });

  it('ne parle jamais de refus automatique', () => {
    for (const [low, high] of [
      [0, 100],
      [10, 90],
      [50, 50],
      [93, 99],
    ] as const) {
      const rendu = [
        ...Object.values(thresholdZoneLabels(low, high)),
        thresholdZoneHint(low, high),
      ]
        .join(' ')
        .toLowerCase();
      expect(rendu).not.toContain('refus auto');
      expect(rendu).not.toContain('automatiquement refus');
    }
  });
});

describe('thresholdZoneHint — les deux cas limites', () => {
  it('seuils collés : plus de zone d’examen, et ça se dit', () => {
    expect(thresholdZoneHint(70, 70)).toBe(
      'Aucune zone d’examen : sous 70 proposé au refus, au-dessus accepté automatiquement.',
    );
  });

  it('0–100 : tout passe par un humain', () => {
    expect(thresholdZoneHint(0, 100)).toBe(
      'Toutes les candidatures passent en validation humaine.',
    );
  });

  it('cas nominal : les trois bandes, bornes comprises', () => {
    expect(thresholdZoneHint(10, 90)).toBe(
      'Proposé au refus < 10 · à examiner 10–90 · acceptation auto ≥ 90',
    );
  });
});

// ── Garde STRUCTURELLE ──────────────────────────────────────────────────────
//
// Les deux curseurs ont divergé parce que chacun portait sa copie des textes.
// Aucun test de logique ne peut attraper ça : un littéral réintroduit dans un
// JSX compile et passe. On lit donc les DEUX fichiers.

const lire = (chemin: string): string =>
  readFileSync(resolve(process.cwd(), chemin), 'utf-8');

const CURSEURS = {
  création: 'src/components/campagnes/edit/draft/ThresholdDraftEditor.tsx',
  édition: 'src/components/campagnes/edit/DecisionThresholdsBlock.tsx',
} as const;

describe('les deux curseurs de seuils lisent la même source', () => {
  it.each(Object.entries(CURSEURS))(
    'le curseur de %s importe threshold-labels',
    (_, chemin) => {
      expect(lire(chemin)).toContain("from '@/lib/campaign/threshold-labels'");
    },
  );

  it.each(Object.entries(CURSEURS))(
    'le curseur de %s ne réécrit aucun libellé de zone en dur',
    (_, chemin) => {
      // Le bloc de commentaire d'en-tête a le droit de RACONTER le défaut
      // (« a affiché Refus auto < N ») ; le code rendu, non.
      const code = lire(chemin)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const interdit of [
        'Refus auto',
        'Proposé au refus <',
        'Accept. auto ≥',
        'Aucun refus n',
      ]) {
        expect(code).not.toContain(interdit);
      }
    },
  );

  it('la phrase partagée est bien celle que les deux affichent', () => {
    expect(NO_AUTOMATIC_REJECTION).toBe(
      'Aucun refus n’est envoyé automatiquement',
    );
    for (const chemin of Object.values(CURSEURS)) {
      expect(lire(chemin)).toContain('{NO_AUTOMATIC_REJECTION}');
    }
  });
});
