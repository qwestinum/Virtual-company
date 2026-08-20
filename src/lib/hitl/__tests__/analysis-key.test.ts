/**
 * Clé d'analyse d'une validation suspendue — PURE.
 *
 * Ce qui se joue ici : le preview et l'envoi doivent tomber sur la MÊME clé,
 * sinon le relecteur ne relit pas le lien qui partira. Et les validations qui
 * étaient déjà en vol au moment de la bascule n'ont rien dans leur charge
 * utile : c'est le repli, dérivé de l'identifiant de validation, qui les sauve.
 */
import { describe, expect, it } from 'vitest';

import { analysisIdForValidation } from '@/lib/hitl/analysis-key';

describe('analysisIdForValidation', () => {
  it('rend la clé portée par la charge utile (cas nominal après lot 3)', () => {
    expect(
      analysisIdForValidation({
        id: 'val_imap_box-a_102_accept',
        payload: { analysisId: 'can_imap_box-a_102', uid: '102' },
      }),
    ).toBe('can_imap_box-a_102');
  });

  it('DÉRIVE la clé d’une validation IMAP en vol (aucune charge utile)', () => {
    expect(
      analysisIdForValidation({ id: 'val_imap_box-a_102_accept', payload: { uid: '102' } }),
    ).toBe('can_imap_box-a_102');
  });

  it('supporte un identifiant de boîte contenant des tirets bas', () => {
    expect(
      analysisIdForValidation({ id: 'val_imap_boite_rh_2_4711_reject', payload: null }),
    ).toBe('can_imap_boite_rh_2_4711');
  });

  it('chemin chat : l’uid EST déjà l’identifiant d’analyse', () => {
    expect(
      analysisIdForValidation({
        id: 'val_chat_xyz',
        payload: { uid: 'can_chat_9f2b' },
      }),
    ).toBe('can_chat_9f2b');
  });

  it('rien d’exploitable ⇒ null (l’appelant n’émet alors aucun lien)', () => {
    expect(analysisIdForValidation({ id: 'val_autre', payload: {} })).toBeNull();
    expect(analysisIdForValidation({ id: 'val_autre' })).toBeNull();
    expect(
      analysisIdForValidation({ id: 'val_autre', payload: { uid: 42 } }),
    ).toBeNull();
  });

  it('la charge utile PRIME sur la dérivation (elle, elle est fiable)', () => {
    expect(
      analysisIdForValidation({
        id: 'val_imap_box-a_102_accept',
        payload: { analysisId: 'can_autre_chose' },
      }),
    ).toBe('can_autre_chose');
  });
});
