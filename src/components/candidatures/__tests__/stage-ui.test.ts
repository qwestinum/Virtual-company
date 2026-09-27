import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatSmartDate,
  initials,
  stagePillStyle,
  stageStepMarks,
} from '@/components/candidatures/stage-ui';
import {
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';

// Dates construites en composantes LOCALES (round-trip ISO) → déterministe quel
// que soit le fuseau du runner. `now` = 30 juin 2026, 18:00 local.
const NOW = new Date(2026, 5, 30, 18, 0, 0);
const iso = (y: number, m: number, d: number, h = 9, min = 0): string =>
  new Date(y, m, d, h, min, 0).toISOString();

describe('formatSmartDate', () => {
  it("aujourd'hui → heure à la minute (séparateur h)", () => {
    expect(formatSmartDate(iso(2026, 5, 30, 15, 33), NOW)).toBe(
      "aujourd'hui à 15h33",
    );
  });

  it('hier → minutes zéro-paddées', () => {
    expect(formatSmartDate(iso(2026, 5, 29, 10, 2), NOW)).toBe('hier à 10h02');
  });

  it('2–6 jours → « il y a N jours »', () => {
    expect(formatSmartDate(iso(2026, 5, 27), NOW)).toBe('il y a 3 jours');
  });

  it('1 semaine', () => {
    expect(formatSmartDate(iso(2026, 5, 22), NOW)).toBe('il y a 1 semaine');
  });

  it('plusieurs semaines (pluriel)', () => {
    expect(formatSmartDate(iso(2026, 5, 9), NOW)).toBe('il y a 3 semaines');
  });

  it('au-delà de ~2 mois → date absolue', () => {
    const old = iso(2026, 0, 15);
    expect(formatSmartDate(old, NOW)).toBe(
      new Date(2026, 0, 15, 9, 0, 0).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  });

  it('date invalide → tiret', () => {
    expect(formatSmartDate('pas-une-date', NOW)).toBe('—');
  });
});

describe('initials', () => {
  it('prend les 2 premières initiales en majuscules', () => {
    expect(initials('Karim Benali')).toBe('KB');
    expect(initials('sophie marchand')).toBe('SM');
    expect(initials('Cher')).toBe('C');
  });
});

// ── Contraste des pastilles d'étape (WCAG 1.4.3, AA texte normal : 4,5:1) ───
//
// Le ratio est RECALCULÉ ici depuis les couleurs réellement servies, jamais
// recopié d'un tableau : c'est le seul moyen qu'un changement de teinte qui
// repasse sous le seuil fasse rougir la suite. Formule de luminance relative
// WCAG 2.1 §« relative luminance ».
//
// ⚠️ Depuis le 21/09/2026, les pastilles ne portent plus de `#hex` mais des
// JETONS (`var(--dash-green-text)`). Le test RÉSOUT donc la variable dans
// `globals.css` avant de mesurer. C'est plus fort qu'avant, pas moins : il
// mesure désormais la valeur que le navigateur servira réellement, et une
// teinte changée dans le CSS fait rougir la suite sans qu'on touche au code.

const CSS = readFileSync(
  resolve(process.cwd(), 'src/app/globals.css'),
  'utf-8',
);

/** `var(--x)` → la valeur déclarée en `:root`. Une variable absente LÈVE. */
const resoudre = (valeur: string): string => {
  const m = /^var\((--[\w-]+)\)$/.exec(valeur.trim());
  if (!m) return valeur;
  const decl = new RegExp(`${m[1]}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(CSS);
  if (!decl) {
    throw new Error(
      `Jeton ${m[1]} introuvable dans globals.css — une pastille pointe une ` +
        'variable qui n’existe pas, donc rien ne s’affiche.',
    );
  }
  return decl[1]!;
};

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  );
};

const contrastRatio = (fg: string, bg: string): number => {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const ALL_STAGES = Object.keys(CANDIDATE_STAGE_LABELS) as CandidateStage[];

describe('stagePillStyle — contraste AA', () => {
  it('couvre les 8 étapes (aucune ne tombe dans un trou de la palette)', () => {
    expect(ALL_STAGES).toHaveLength(8);
    for (const stage of ALL_STAGES) {
      const { color, background } = stagePillStyle(stage);
      expect(resoudre(color)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(resoudre(background)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(ALL_STAGES)('« %s » atteint 4,5:1', (stage) => {
    const { color, background } = stagePillStyle(stage);
    expect(
      contrastRatio(resoudre(color), resoudre(background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('la formule sait détecter un échec (sonde : la palette ORQA retirée)', () => {
    // « Invité » d'avant : #2b9fd8 sur #e6f4fb, mesuré à 2,65:1. Si cette
    // assertion devenait fausse, le test ci-dessus ne prouverait plus rien.
    expect(contrastRatio('#2b9fd8', '#e6f4fb')).toBeLessThan(4.5);
  });
});

describe('stageStepMarks — repère non chromatique', () => {
  it('distingue les trois étapes qui PARTAGENT une couleur', () => {
    const progress: CandidateStage[] = ['invite', 'rdv_pris', 'entretien_fait'];

    // Prémisse du test : ces trois-là sortent bien de la même couleur.
    const colors = new Set(progress.map((s) => stagePillStyle(s).color));
    expect(colors.size).toBe(1);

    // Donc leurs repères, eux, doivent différer deux à deux.
    const marks = progress.map((s) => stageStepMarks(s).join(''));
    expect(new Set(marks).size).toBe(3);
  });

  it('remplit jusqu\'au rang de l\'étape', () => {
    expect(stageStepMarks('a_valider')).toEqual([true, false, false, false, false]);
    expect(stageStepMarks('invite')).toEqual([true, true, false, false, false]);
    expect(stageStepMarks('rdv_pris')).toEqual([true, true, true, false, false]);
    expect(stageStepMarks('entretien_fait')).toEqual([true, true, true, true, false]);
    expect(stageStepMarks('retenu')).toEqual([true, true, true, true, true]);
  });

  it('les terminaux hors pipeline ne portent aucun repère', () => {
    expect(stageStepMarks('non_retenu')).toEqual([]);
    expect(stageStepMarks('refus_auto')).toEqual([]);
    expect(stageStepMarks('sans_suite')).toEqual([]);
  });
});
