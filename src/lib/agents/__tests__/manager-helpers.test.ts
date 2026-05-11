import { describe, expect, it } from 'vitest';

import {
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
