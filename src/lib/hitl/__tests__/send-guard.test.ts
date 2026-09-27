import { describe, expect, it } from 'vitest';

import { checkHitlSend } from '@/lib/hitl/send-guard';

describe('checkHitlSend — un mail ne part que sur la décision enregistrée', () => {
  it('fiche réservée, même décision ⇒ envoi autorisé', () => {
    expect(checkHitlSend({ status: 'sending', decision: 'accept' }, 'invite')).toEqual({ ok: true });
    expect(checkHitlSend({ status: 'sending', decision: 'reject' }, 'reject')).toEqual({ ok: true });
  });

  it('fiche déjà envoyée ⇒ laissé au claim (réessai sûr, `duplicate`)', () => {
    expect(checkHitlSend({ status: 'sent', decision: 'accept' }, 'invite')).toEqual({ ok: true });
  });

  it('invitation sur une fiche qui dit « refuser » ⇒ refusé (régression S4)', () => {
    expect(checkHitlSend({ status: 'sending', decision: 'reject' }, 'invite')).toEqual({
      ok: false,
      error: 'decision_mismatch',
    });
  });

  it('refus sur une fiche qui dit « accepter » ⇒ refusé', () => {
    expect(checkHitlSend({ status: 'sending', decision: 'accept' }, 'reject')).toEqual({
      ok: false,
      error: 'decision_mismatch',
    });
  });

  it('fiche non réservée ⇒ refusé (jamais d’envoi hors réservation)', () => {
    expect(checkHitlSend({ status: 'pending', decision: 'accept' }, 'invite')).toEqual({
      ok: false,
      error: 'not_reserved',
    });
    expect(checkHitlSend({ status: 'void', decision: 'reject' }, 'reject')).toEqual({
      ok: false,
      error: 'not_reserved',
    });
  });

  it('fiche introuvable ⇒ refusé', () => {
    expect(checkHitlSend(null, 'reject')).toEqual({ ok: false, error: 'validation_not_found' });
  });
});
