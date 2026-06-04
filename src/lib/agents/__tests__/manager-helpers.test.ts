import { describe, expect, it } from 'vitest';

import {
  ensureAdjustChip,
  FALLBACK_CHIP_ADJUST,
  hasClarificationRequestKeyword,
  hasSwitchIntentKeyword,
} from '@/lib/agents/manager';

describe('hasSwitchIntentKeyword', () => {
  it('matches explicit campaign verbs with target', () => {
    expect(hasSwitchIntentKeyword('je veux lancer une campagne')).toBe(true);
    expect(hasSwitchIntentKeyword('ouvre une nouvelle tâche')).toBe(true);
    expect(
      hasSwitchIntentKeyword('démarrer une nouvelle sollicitation'),
    ).toBe(true);
    expect(hasSwitchIntentKeyword('initier un recrutement')).toBe(true);
  });

  it('matches "nouvelle campagne/tâche/sollicitation/recrutement" phrases', () => {
    expect(hasSwitchIntentKeyword('passons sur une nouvelle campagne')).toBe(
      true,
    );
    expect(hasSwitchIntentKeyword('nouvelle tâche pour autre poste')).toBe(
      true,
    );
  });

  it('matches transition markers', () => {
    expect(hasSwitchIntentKeyword('en fait je veux un commercial')).toBe(true);
    expect(hasSwitchIntentKeyword('plutôt un développeur python')).toBe(true);
    expect(hasSwitchIntentKeyword('à la place un comptable')).toBe(true);
    expect(hasSwitchIntentKeyword('finalement non')).toBe(true);
  });

  it('matches abandon verbs', () => {
    expect(hasSwitchIntentKeyword('abandonner cette campagne')).toBe(true);
    expect(hasSwitchIntentKeyword('on abandonne')).toBe(true);
  });

  it('does NOT match short replies to collection questions', () => {
    expect(hasSwitchIntentKeyword('ok')).toBe(false);
    expect(hasSwitchIntentKeyword('oui')).toBe(false);
    expect(hasSwitchIntentKeyword('non')).toBe(false);
    expect(hasSwitchIntentKeyword('senior')).toBe(false);
    expect(hasSwitchIntentKeyword('Paris')).toBe(false);
    expect(hasSwitchIntentKeyword('50K')).toBe(false);
    expect(hasSwitchIntentKeyword('CDI')).toBe(false);
  });

  it('does NOT match natural mentions of "campagne actuelle"', () => {
    expect(hasSwitchIntentKeyword('continue la campagne actuelle')).toBe(
      false,
    );
    expect(hasSwitchIntentKeyword('garde la campagne en cours')).toBe(false);
  });

  it('does NOT match generic verbs without a target', () => {
    expect(hasSwitchIntentKeyword("j'aime lancer des projets")).toBe(false);
    expect(hasSwitchIntentKeyword('on va démarrer le travail')).toBe(false);
  });
});

describe('hasClarificationRequestKeyword', () => {
  it('matches explicit explanation requests', () => {
    expect(hasClarificationRequestKeyword('explique-moi')).toBe(true);
    expect(hasClarificationRequestKeyword('Explique pourquoi')).toBe(true);
    expect(hasClarificationRequestKeyword('pourquoi cette fourchette ?')).toBe(
      true,
    );
    expect(hasClarificationRequestKeyword("qu'est-ce que ça veut dire")).toBe(
      true,
    );
    expect(hasClarificationRequestKeyword("c'est quoi un DSCG")).toBe(true);
    expect(hasClarificationRequestKeyword('je ne comprends pas')).toBe(true);
    expect(hasClarificationRequestKeyword('précise-moi le contrat')).toBe(true);
    expect(hasClarificationRequestKeyword('détaille les missions')).toBe(true);
    expect(hasClarificationRequestKeyword('éclaircis ce point')).toBe(true);
    expect(hasClarificationRequestKeyword('un éclaircissement svp')).toBe(true);
    expect(hasClarificationRequestKeyword('clarifie ta proposition')).toBe(
      true,
    );
  });

  it('matches "comment ça marche/fonctionne" patterns', () => {
    expect(
      hasClarificationRequestKeyword('comment ça marche cette grille ?'),
    ).toBe(true);
    expect(
      hasClarificationRequestKeyword('comment tu gères les rédhibitoires ?'),
    ).toBe(true);
  });

  it('does NOT match normal short replies', () => {
    expect(hasClarificationRequestKeyword('ok')).toBe(false);
    expect(hasClarificationRequestKeyword('senior')).toBe(false);
    expect(hasClarificationRequestKeyword('CDI')).toBe(false);
  });

  it('does NOT match unrelated mentions of similar words', () => {
    // "comment" sans contexte d'explication
    expect(hasClarificationRequestKeyword('comment va le projet')).toBe(false);
  });
});

describe('ensureAdjustChip', () => {
  it('appends « Ajuster » to inline chips that lack any adjustment signal', () => {
    const out = ensureAdjustChip({
      message: 'Pour la fourchette, je vois 50-65K. On part là-dessus ?',
      chips: {
        placement: 'inline',
        options: ['Utiliser 50-65K', 'Plus haut (60-75K)', 'Plus bas (45-58K)'],
      },
    });
    expect(out.chips?.options).toEqual([
      'Utiliser 50-65K',
      'Plus haut (60-75K)',
      'Plus bas (45-58K)',
      FALLBACK_CHIP_ADJUST,
    ]);
  });

  it('leaves inline chips untouched when an adjustment signal is already present', () => {
    const chips = {
      placement: 'inline' as const,
      options: ['Garder cette liste', 'Ajuster'],
    };
    const out = ensureAdjustChip({ message: 'm', chips });
    expect(out.chips?.options).toEqual(['Garder cette liste', 'Ajuster']);
  });

  it('recognizes alternative adjustment wordings (« Autre ») without duplicating', () => {
    const out = ensureAdjustChip({
      message: 'm',
      chips: { placement: 'inline', options: ['Utiliser cette valeur', 'Autre'] },
    });
    expect(out.chips?.options).toEqual(['Utiliser cette valeur', 'Autre']);
  });

  it('respects the 5-option cap by evicting the last preset', () => {
    const out = ensureAdjustChip({
      message: 'm',
      chips: {
        placement: 'inline',
        options: ['A', 'B', 'C', 'D', 'E'],
      },
    });
    expect(out.chips?.options).toEqual(['A', 'B', 'C', 'D', FALLBACK_CHIP_ADJUST]);
    expect(out.chips?.options.length).toBe(5);
  });

  it('appends « Ajuster » to a canonical seniority chip set (below_bubble)', () => {
    const out = ensureAdjustChip({
      message: 'Je verrais bien un profil confirmé.',
      chips: { placement: 'below_bubble', options: ['junior', 'confirmé', 'senior'] },
    });
    expect(out.chips?.options).toEqual([
      'junior',
      'confirmé',
      'senior',
      FALLBACK_CHIP_ADJUST,
    ]);
  });

  it('appends « Ajuster » to a canonical contract_type chip set, capped at 5', () => {
    const out = ensureAdjustChip({
      message: 'Je pars sur un CDI.',
      chips: {
        placement: 'below_bubble',
        options: ['CDI', 'CDD', 'freelance', 'stage'],
      },
    });
    expect(out.chips?.options).toEqual([
      'CDI',
      'CDD',
      'freelance',
      'stage',
      FALLBACK_CHIP_ADJUST,
    ]);
    expect(out.chips?.options.length).toBe(5);
  });

  it('recognizes canonical values case-insensitively', () => {
    const out = ensureAdjustChip({
      message: 'm',
      chips: { placement: 'below_bubble', options: ['Junior', 'Senior'] },
    });
    expect(out.chips?.options).toEqual(['Junior', 'Senior', FALLBACK_CHIP_ADJUST]);
  });

  it('does NOT touch non-canonical below_bubble sets (récap, switch, reuse)', () => {
    const recap = {
      message: 'm',
      chips: {
        placement: 'below_bubble' as const,
        options: ['Valider la fiche de poste', 'Ajuster'],
      },
    };
    expect(ensureAdjustChip(recap).chips?.options).toEqual([
      'Valider la fiche de poste',
      'Ajuster',
    ]);
    const reuse = {
      message: 'm',
      chips: {
        placement: 'below_bubble' as const,
        options: ['Tout valider', 'Examiner champ par champ'],
      },
    };
    // Aucune option n'est une valeur d'enum → set non canonique → intact.
    expect(ensureAdjustChip(reuse).chips?.options).toEqual([
      'Tout valider',
      'Examiner champ par champ',
    ]);
  });

  it('does NOT touch above_input placements', () => {
    const above = {
      message: 'm',
      chips: { placement: 'above_input' as const, options: ['Continuer', 'Voir un exemple'] },
    };
    expect(ensureAdjustChip(above).chips?.options).toEqual([
      'Continuer',
      'Voir un exemple',
    ]);
  });

  it('is a no-op when there are no chips', () => {
    const input: { message: string; chips?: { placement: string; options: string[] } } = {
      message: 'm',
    };
    const out = ensureAdjustChip(input);
    expect(out.chips).toBeUndefined();
  });
});
