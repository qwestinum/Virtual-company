/**
 * Reconstruction d'une ligne de file à partir de l'analyse.
 *
 * Ce que ces tests tiennent, et que le typage ne peut pas : les REFUS. Une
 * re-mise en file est une réparation, jamais une réouverture — laisser passer
 * un dossier déjà tranché ou déjà classé remettrait en jeu une décision prise.
 */
import { describe, expect, it } from 'vitest';

import { buildValidationFromAnalysis } from '@/lib/hitl/validation-from-analysis';
import type { CVApplication } from '@/types/cv-analysis';
import type { DecisionZone } from '@/types/hitl';
import type { CandidateAnalysisDetail } from '@/types/reporting';

const NOW = new Date('2026-09-20T10:00:00.000Z');

function application(): CVApplication {
  return {
    candidate: {
      fullName: 'Mila Renard',
      email: 'mila.renard@exemple.fr',
      phone: '+33 6 00 00 00 00',
      detectedLanguage: 'fr',
      fileName: 'CV-Mila-Renard.pdf',
      source: 'email',
      receivedAt: '2026-09-10T08:00:00.000Z',
      rightToWork: true,
      location: 'Lyon',
      photoPresent: false,
    },
    scoringResult: {
      totalScore: 42,
      status: 'rejected',
      decisionZone: 'proposed_reject',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v3',
      computedAt: '2026-09-10T08:01:00.000Z',
    },
    narration: {
      summary: 'Profil junior sur le poste visé.',
      strengths: ['Rigueur'],
      weaknesses: ['Peu d’expérience'],
      justification: 'Score sous la bande de validation.',
    },
  };
}

function analysis(
  over: Partial<CandidateAnalysisDetail> = {},
): CandidateAnalysisDetail {
  return {
    id: 'can_imap_mb_42_1903',
    uid: '1903',
    campaignId: 'CAMP-2026-511',
    candidateName: 'Mila Renard',
    candidateEmail: 'mila.renard@exemple.fr',
    fileName: 'CV-Mila-Renard.pdf',
    source: 'email',
    receivedAt: '2026-09-10T08:00:00.000Z',
    totalScore: 42,
    status: 'rejected',
    computedAt: '2026-09-10T08:01:00.000Z',
    createdAt: '2026-09-10T08:01:00.000Z',
    hitlConfig: { enabled: true, rejectionMail: true, invitationMail: true },
    decisionZone: 'proposed_reject' as DecisionZone,
    decidedBy: 'auto',
    decidedByUser: null,
    fromVivier: false,
    vivierCandidateId: null,
    dismissedAt: null,
    dismissalReason: null,
    dismissedBy: null,
    dismissedByUser: null,
    application: application(),
    ...over,
  } as CandidateAnalysisDetail;
}

describe('buildValidationFromAnalysis — ce qu’il REFUSE', () => {
  it('refuse une candidature déjà tranchée par un humain', () => {
    // Remettre en file rouvrirait une décision prise. La réparation d'une
    // erreur passe par « Corriger la décision », pas par ici.
    const out = buildValidationFromAnalysis(analysis({ decidedBy: 'user' }), null, NOW);
    expect(out).toEqual({ ok: false, reason: 'decided_by_human' });
  });

  it('refuse une candidature classée sans suite', () => {
    const out = buildValidationFromAnalysis(
      analysis({ dismissedAt: '2026-09-12T10:00:00.000Z' }),
      null,
      NOW,
    );
    expect(out).toEqual({ ok: false, reason: 'dismissed' });
  });

  it('refuse une zone qui n’attend PAS de décision humaine', () => {
    for (const zone of ['auto_accept', 'auto_reject'] as DecisionZone[]) {
      const out = buildValidationFromAnalysis(analysis({ decisionZone: zone }), null, NOW);
      expect(out).toEqual({ ok: false, reason: 'not_awaiting' });
    }
  });

  it('refuse une zone absente (ligne historique) plutôt que de deviner', () => {
    const out = buildValidationFromAnalysis(analysis({ decisionZone: null }), null, NOW);
    expect(out).toEqual({ ok: false, reason: 'not_awaiting' });
  });

  it('refuse une candidature sans campagne', () => {
    const out = buildValidationFromAnalysis(analysis({ campaignId: null }), null, NOW);
    expect(out).toEqual({ ok: false, reason: 'no_campaign' });
  });
});

describe('buildValidationFromAnalysis — ce qu’il CONSTRUIT', () => {
  it('accepte les deux zones d’attente', () => {
    for (const zone of ['gray', 'proposed_reject'] as DecisionZone[]) {
      expect(buildValidationFromAnalysis(analysis({ decisionZone: zone }), null, NOW).ok).toBe(true);
    }
  });

  it('pose un identifiant DÉTERMINISTE dérivé de l’analyse', () => {
    const out = buildValidationFromAnalysis(analysis(), null, NOW);
    expect(out.ok && out.validation.id).toBe('val_imap_mb_42_1903_reject');
  });

  it('naît en attente, non confirmée, sans décideur', () => {
    const out = buildValidationFromAnalysis(analysis(), null, NOW);
    if (!out.ok) throw new Error('attendu ok');
    expect(out.validation.status).toBe('pending');
    expect(out.validation.confirmed).toBe(false);
    expect(out.validation.decidedBy).toBeNull();
    expect(out.validation.decidedAt).toBeNull();
    // Direction PROVISOIRE : un dossier en attente n'a aucune direction décidée.
    expect(out.validation.decision).toBe('reject');
  });

  it('porte la charge utile que la carte de validation consomme', () => {
    const out = buildValidationFromAnalysis(analysis(), 'Ingénieur data', NOW);
    if (!out.ok) throw new Error('attendu ok');
    expect(out.validation.payload.uid).toBe('1903');
    expect(out.validation.payload.analysisId).toBe('can_imap_mb_42_1903');
    expect(out.validation.payload.jobTitle).toBe('Ingénieur data');
    expect(out.validation.payload.summary).toBe('Profil junior sur le poste visé.');
    expect(out.validation.payload.candidate).toMatchObject({
      candidateName: 'Mila Renard',
      email: 'mila.renard@exemple.fr',
      score: 42,
    });
  });

  it('n’invente AUCUN lien d’artefact', () => {
    // Les artefacts ne se devinent pas depuis l'analyse ; un lien inventé
    // afficherait un bouton qui ne mène nulle part.
    const out = buildValidationFromAnalysis(analysis(), null, NOW);
    if (!out.ok) throw new Error('attendu ok');
    expect(out.validation.cvArtifactId).toBeNull();
    expect(out.validation.reportArtifactId).toBeNull();
    expect(out.validation.mailDraftArtifactId).toBeNull();
  });

  it('accepte un intitulé de poste absent sans casser', () => {
    const out = buildValidationFromAnalysis(analysis(), null, NOW);
    expect(out.ok && out.validation.payload.jobTitle).toBeNull();
  });
});
