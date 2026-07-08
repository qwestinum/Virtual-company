import { describe, expect, it } from 'vitest';

import {
  emailBodyText,
  findAllCampaignIdsInText,
  resolveCampaignMatch,
} from '@/lib/imap/campaign-match';

const A = 'CAMP-2026-100';
const B = 'CAMP-2026-200';
const C = 'CAMP-2026-300';

describe('findAllCampaignIdsInText', () => {
  it('distinct, ordre de la liste (pas de l’apparition)', () => {
    const text = `mentionne ${B} puis ${A} puis encore ${B}`;
    expect(findAllCampaignIdsInText(text, [A, B, C])).toEqual([A, B]);
  });

  it('insensible à la casse', () => {
    expect(findAllCampaignIdsInText('ref camp-2026-100 ok', [A])).toEqual([A]);
  });

  it('vide sur texte absent', () => {
    expect(findAllCampaignIdsInText(null, [A])).toEqual([]);
    expect(findAllCampaignIdsInText('', [A])).toEqual([]);
  });
});

describe('resolveCampaignMatch — priorité sujet, repli corps', () => {
  const active = [A, B];
  const associated = [A, B, C]; // C = associée mais inactive

  it('sujet actif = nominal (source subject), le corps est ignoré', () => {
    const m = resolveCampaignMatch({
      subject: `Candidature ${A}`,
      body: `un fil qui cite aussi ${B}`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'active', campaignId: A, source: 'subject' });
  });

  it('sujet vide → repli sur le corps (1 seule active) = source body', () => {
    const m = resolveCampaignMatch({
      subject: 'Fwd: ma candidature',
      body: `Bonjour, je postule pour ${A}. Cordialement.`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'active', campaignId: A, source: 'body' });
  });

  it('PLUSIEURS campagnes actives distinctes dans le corps → ambiguous (ne devine pas)', () => {
    const m = resolveCampaignMatch({
      subject: 'Fwd: transfert',
      body: `historique : ${A} ... et plus bas ${B}`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({
      kind: 'ambiguous',
      campaignIds: [A, B],
      source: 'body',
    });
  });

  it('même ID répété dans le corps n’est PAS ambigu', () => {
    const m = resolveCampaignMatch({
      subject: null,
      body: `${A} cité deux fois ${A}`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'active', campaignId: A, source: 'body' });
  });

  it('une active + une inactive dans le corps → rattache à l’ACTIVE (pas ambigu)', () => {
    const m = resolveCampaignMatch({
      subject: null,
      body: `${A} (active) et ${C} (inactive)`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'active', campaignId: A, source: 'body' });
  });

  it('sujet inactif → inactive/subject (visibilité), pas de rattachement', () => {
    const m = resolveCampaignMatch({
      subject: `Candidature ${C}`,
      body: '',
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'inactive', campaignId: C, source: 'subject' });
  });

  it('corps inactif seul → inactive/body (visibilité)', () => {
    const m = resolveCampaignMatch({
      subject: 'Fwd:',
      body: `je postule ${C}`,
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'inactive', campaignId: C, source: 'body' });
  });

  it('aucun ID nulle part → none', () => {
    const m = resolveCampaignMatch({
      subject: 'Bonjour',
      body: 'Voici mon CV.',
      activeIds: active,
      associatedIds: associated,
    });
    expect(m).toEqual({ kind: 'none' });
  });
});

describe('emailBodyText — plaintext prioritaire, repli HTML dé-balisé', () => {
  it('renvoie le text quand présent', () => {
    expect(emailBodyText({ text: `postule ${A}`, html: '<p>autre</p>' })).toBe(
      `postule ${A}`,
    );
  });

  it('dé-balise le html quand text absent (HTML-only)', () => {
    const out = emailBodyText({
      html: `<div>Bonjour,&nbsp;<b>${A}</b></div>`,
    });
    expect(out).toContain(A);
    expect(out).not.toContain('<');
  });

  it('vide quand ni text ni html', () => {
    expect(emailBodyText({ text: null, html: false })).toBe('');
  });
});
