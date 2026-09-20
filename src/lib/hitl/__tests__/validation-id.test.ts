/**
 * L'identifiant de validation est un CONTRAT : il doit continuer de produire
 * EXACTEMENT les identifiants déjà en base. Une dérive créerait un doublon au
 * lieu de retrouver la ligne existante — et un doublon dans la file, c'est le
 * même candidat proposé deux fois au recruteur.
 */
import { describe, expect, it } from 'vitest';

import { analysisIdForValidation } from '@/lib/hitl/analysis-key';
import {
  provisionalDecisionFor,
  validationIdFor,
} from '@/lib/hitl/validation-id';

const MAILBOX = 'mb_934c36ee-e22c-4e9e-b249-ff984811346f';

describe('validationIdFor', () => {
  it('reproduit les identifiants IMAP déjà en base', () => {
    expect(validationIdFor(`can_imap_${MAILBOX}_1903`, 'reject')).toBe(
      `val_imap_${MAILBOX}_1903_reject`,
    );
    expect(validationIdFor(`can_imap_${MAILBOX}_1626`, 'accept')).toBe(
      `val_imap_${MAILBOX}_1626_accept`,
    );
  });

  it('reproduit la convention du sourcing', () => {
    expect(validationIdFor('can_src_7f3a-42', 'reject')).toBe('val_src_7f3a-42_reject');
  });

  it("accepte un identifiant d'analyse sans préfixe (chemin chat)", () => {
    expect(validationIdFor('cvb_mt03645w_c5fx_1', 'reject')).toBe(
      'val_cvb_mt03645w_c5fx_1_reject',
    );
  });

  it('ne retire QUE le préfixe de tête', () => {
    // `can_` au milieu d'un identifiant n'est pas un préfixe.
    expect(validationIdFor('can_imap_mb_can_x_12', 'reject')).toBe(
      'val_imap_mb_can_x_12_reject',
    );
  });

  it('est stable : deux appels donnent le même identifiant', () => {
    const a = validationIdFor(`can_imap_${MAILBOX}_42`, 'reject');
    const b = validationIdFor(`can_imap_${MAILBOX}_42`, 'reject');
    expect(a).toBe(b);
  });

  it("fait l'aller-retour avec analysisIdForValidation (IMAP)", () => {
    const analysisId = `can_imap_${MAILBOX}_1903`;
    const id = validationIdFor(analysisId, 'reject');
    expect(analysisIdForValidation({ id, payload: null })).toBe(analysisId);
  });
});

describe('provisionalDecisionFor', () => {
  it("n'accepte que l'acceptation automatique", () => {
    expect(provisionalDecisionFor('auto_accept')).toBe('accept');
  });

  it('pose « reject » comme placeholder pour toute zone en attente', () => {
    // Ce n'est PAS une décision : la carte compose le mail quand l'humain
    // tranche. Un `accept` ici laisserait croire le candidat déjà invité.
    expect(provisionalDecisionFor('gray')).toBe('reject');
    expect(provisionalDecisionFor('proposed_reject')).toBe('reject');
    expect(provisionalDecisionFor('auto_reject')).toBe('reject');
  });
});
