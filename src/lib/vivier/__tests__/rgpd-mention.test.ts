import { describe, expect, it } from 'vitest';

import {
  buildVivierRgpdMention,
  stripVivierRgpdMention,
  withRgpdMentionAppended,
} from '@/lib/vivier/rgpd-mention';

const CONTACT = 'recrutement@exemple.fr';

describe('buildVivierRgpdMention', () => {
  it('nomme le contact auquel demander la suppression', () => {
    expect(buildVivierRgpdMention(CONTACT)).toContain(CONTACT);
  });

  it('reste une phrase valable sans contact (jamais un trou dans le texte)', () => {
    expect(buildVivierRgpdMention('   ')).toContain('notre service recrutement');
  });
});

describe('stripVivierRgpdMention — retrouve la mention quel que soit le contact', () => {
  it('retire la mention posée avec une AUTRE adresse', () => {
    const text = `Le poste.\n\n${buildVivierRgpdMention('ancienne@exemple.fr')}`;
    expect(stripVivierRgpdMention(text)).toBe('Le poste.');
  });

  it('laisse intact un texte qui n’en porte pas', () => {
    expect(stripVivierRgpdMention('Le poste, tout simplement.')).toBe(
      'Le poste, tout simplement.',
    );
  });
});

describe('withRgpdMentionAppended — une fois, et une seule', () => {
  it('appose la mention à un texte qui n’en a pas', () => {
    const out = withRgpdMentionAppended('Le poste.', CONTACT);
    expect(out.startsWith('Le poste.')).toBe(true);
    expect(out).toContain(CONTACT);
  });

  it('n’EMPILE pas : un texte déjà pourvu n’en reçoit pas une deuxième', () => {
    // Le cas réel : le descriptif affiché repart comme matériau à reformuler.
    const once = withRgpdMentionAppended('Le poste.', CONTACT);
    const twice = withRgpdMentionAppended(once, CONTACT);
    expect(twice).toBe(once);
    expect(
      twice.split('Vos données pourront être conservées').length - 1,
    ).toBe(1);
  });

  it('remplace une mention posée avec un contact périmé', () => {
    const stale = withRgpdMentionAppended('Le poste.', 'ancienne@exemple.fr');
    const fresh = withRgpdMentionAppended(stale, CONTACT);
    expect(fresh).toContain(CONTACT);
    expect(fresh).not.toContain('ancienne@exemple.fr');
  });
});
