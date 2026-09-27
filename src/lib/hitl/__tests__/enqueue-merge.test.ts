import { describe, expect, it } from 'vitest';

import {
  ENQUEUE_REFRESHABLE,
  mergePendingValidationEnqueue,
} from '@/lib/hitl/enqueue-merge';
import type { PendingValidation } from '@/types/hitl';

function validation(over: Partial<PendingValidation> = {}): PendingValidation {
  return {
    id: 'val_imap_mb_1_1625_reject',
    campaignId: 'CAMP-2026-503',
    candidateName: 'Imad BELFAQIR',
    candidateEmail: 'imad@example.com',
    score: 55,
    decision: 'reject',
    cvArtifactId: null,
    reportArtifactId: 'art_report_a',
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: { uid: '1625' },
    createdAt: '2026-07-20T12:48:45.000Z',
    updatedAt: '2026-07-20T12:48:45.000Z',
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
    ...over,
  };
}

describe('mergePendingValidationEnqueue', () => {
  it('écrit la validation fraîche telle quelle quand rien n’existe', () => {
    const fresh = validation({ cvArtifactId: 'art_cv_1' });
    const res = mergePendingValidationEnqueue(null, fresh);
    expect(res).toEqual({ write: true, value: fresh });
  });

  it('ne remplace JAMAIS un cvArtifactId non-null par null (incident 07/2026)', () => {
    const existing = validation({ cvArtifactId: 'art_imap_cvfile_mb_1_1625' });
    const fresh = validation({
      cvArtifactId: null,
      createdAt: '2026-07-24T12:50:27.000Z',
      updatedAt: '2026-07-24T12:50:27.000Z',
    });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res.write).toBe(true);
    if (res.write) {
      expect(res.value.cvArtifactId).toBe('art_imap_cvfile_mb_1_1625');
    }
  });

  it('préserve aussi reportArtifactId et mailDraftArtifactId non-null', () => {
    const existing = validation({
      reportArtifactId: 'art_report_a',
      mailDraftArtifactId: 'art_mail_a',
    });
    const fresh = validation({
      reportArtifactId: null,
      mailDraftArtifactId: null,
    });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res.write).toBe(true);
    if (res.write) {
      expect(res.value.reportArtifactId).toBe('art_report_a');
      expect(res.value.mailDraftArtifactId).toBe('art_mail_a');
    }
  });

  it('un lien frais non-null remplace l’ancien (rapport re-généré)', () => {
    const existing = validation({ reportArtifactId: 'art_report_a' });
    const fresh = validation({ reportArtifactId: 'art_report_b' });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res.write).toBe(true);
    if (res.write) expect(res.value.reportArtifactId).toBe('art_report_b');
  });

  it('conserve le createdAt d’origine (date de première réception)', () => {
    const existing = validation({ createdAt: '2026-07-20T12:48:45.000Z' });
    const fresh = validation({
      createdAt: '2026-07-24T12:50:27.000Z',
      updatedAt: '2026-07-24T12:50:27.000Z',
    });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res.write).toBe(true);
    if (res.write) {
      expect(res.value.createdAt).toBe('2026-07-20T12:48:45.000Z');
      expect(res.value.updatedAt).toBe('2026-07-24T12:50:27.000Z');
    }
  });

  it('ne ré-ouvre JAMAIS une validation sent (décision immuable, audit C6)', () => {
    const existing = validation({ status: 'sent', decidedBy: 'user' });
    const fresh = validation({ cvArtifactId: 'art_cv_1' });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res).toEqual({ write: false, reason: 'already_engaged' });
  });

  it('ne touche pas une validation sending (envoi en cours)', () => {
    const existing = validation({ status: 'sending' });
    const res = mergePendingValidationEnqueue(existing, validation());
    expect(res).toEqual({ write: false, reason: 'already_engaged' });
  });
});

describe('une remise en file ne touche jamais à ce que l’humain a posé', () => {
  const human = {
    userId: 'u_recruteur',
    email: 'recruteur@example.com',
  };

  it('« basculé puis remis en file » : la décision humaine SURVIT (régression S4)', () => {
    // Le recruteur a choisi « accepter » (PATCH decision + confirmed), la
    // réservation d'envoi n'est pas encore posée : la fiche est `pending`.
    const existing = validation({
      decision: 'accept',
      confirmed: true,
      decidedBy: 'user',
      decidedByUser: human,
      mailDraftArtifactId: 'art_mail_invite',
    });
    // Une remise en file arrive (filet serveur, réessai IMAP…) avec la
    // direction PROVISOIRE d'une fiche : toujours `reject`.
    const fresh = validation({
      decision: 'reject',
      confirmed: false,
      decidedBy: null,
      decidedByUser: null,
      mailDraftArtifactId: 'art_mail_reject',
      score: 58,
      updatedAt: '2026-07-24T12:50:27.000Z',
    });
    const res = mergePendingValidationEnqueue(existing, fresh);
    expect(res.write).toBe(true);
    if (!res.write) return;
    expect(res.value.decision).toBe('accept');
    expect(res.value.confirmed).toBe(true);
    expect(res.value.decidedBy).toBe('user');
    expect(res.value.decidedByUser).toEqual(human);
    // Le brouillon suit la décision, pas la remise en file.
    expect(res.value.mailDraftArtifactId).toBe('art_mail_invite');
    // Ce que l'analyse sait du dossier, lui, est rafraîchi.
    expect(res.value.score).toBe(58);
    expect(res.value.updatedAt).toBe('2026-07-24T12:50:27.000Z');
  });

  it('la liste des champs rafraîchissables ne contient aucun champ de décision', () => {
    for (const forbidden of [
      'id',
      'decision',
      'confirmed',
      'status',
      'decidedAt',
      'decidedBy',
      'decidedByUser',
      'mailDraftArtifactId',
      'createdAt',
    ]) {
      expect(ENQUEUE_REFRESHABLE as readonly string[]).not.toContain(forbidden);
    }
  });
});
