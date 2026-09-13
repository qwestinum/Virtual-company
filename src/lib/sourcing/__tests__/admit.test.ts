/**
 * Manifestation — `admitSourcedCandidate`. Base, modèle, envoi simulés : ce
 * qui est testé, c'est ce que l'admission écrit, dans quel ordre, et ce
 * qu'elle refuse de faire sous panne.
 */
import { describe, expect, it, vi } from 'vitest';

import { AnalysisUnavailableError } from '@/lib/ai/errors';

const APPROACH_ID = '11111111-2222-3333-4444-555555555555';
const submission = {
  email: 'claire.martin@exemple.fr', phone: '06 12 34 56 78', consent: true as const, fullName: 'Claire Martin',
  workHistory: [{ title: 'Business Analyst', company: 'Banque X', from: '2024-05', to: null }], education: [], about: 'AMOA', cv: null,
};
const pending = {
  id: APPROACH_ID, campaignId: 'CAMP-2026-293', profileId: 'p1', fingerprint: 'f'.repeat(64), recruiterId: 'u1',
  channel: 'linkedin' as const, messageFormat: 'connection_note' as const, message: null, status: 'admission_pending' as const,
  initiatedAt: '2026-09-10T09:00:00Z', firstOpenedAt: '2026-09-11T09:00:00Z', submittedAt: '2026-09-14T10:00:00Z',
  submission, admissionAttempts: 0, updatedAt: '2026-09-14T10:00:00Z',
};
const analyzed = {
  candidate: { fullName: 'C. M.', email: 'autre@cv.fr', phone: null, fileName: 'cv.pdf', source: 'sourcing', receivedAt: '2026-09-14T10:00:00Z' },
  scoringResult: { totalScore: 41, status: 'rejected', decisionZone: 'proposed_reject', breakdown: [], hardFailures: [], criteriaVersion: 'v1', computedAt: 'x' },
  narration: { summary: 'Profil AMOA.', strengths: [], weaknesses: [], justification: 'Sous le seuil.' },
};

const campaign = { id: 'CAMP-2026-293', status: 'active', thresholdLow: 50, thresholdHigh: 80, fdp: { fields: { job_title: { value: 'Business Analyst' } } }, scoringSheet: { isValidated: true, criteria: [] } };
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn(async () => campaign) }));
vi.mock('@/lib/agents/server/interview-mail', () => ({ canInviteForCampaign: vi.fn(async () => true) }));
vi.mock('@/lib/agents/server/cv-application-analyze', () => ({ analyzeCVApplication: vi.fn(async () => ({ application: analyzed, isCv: true })) }));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  getCandidateAnalysis: vi.fn(async () => null),
  persistCandidateAnalysisStrict: vi.fn(async () => 'inserted'),
}));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: vi.fn(async () => ({ displayName: 'Jane R.', email: 'jane@cabinet.fr' })) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/artifacts', () => ({ upsertArtifactMeta: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/sourcing-admission', () => ({
  completeAdmission: vi.fn(async () => {}),
  recordAdmissionFailure: vi.fn(async () => {}),
  releaseSubmission: vi.fn(async () => {}),
  settleManifestedProfile: vi.fn(async () => {}),
}));
vi.mock('@/lib/imap/outreach', () => ({ dispatchCandidateOutreach: vi.fn(async () => {}) }));
vi.mock('@/lib/sourcing/server/structured-cv-pdf', () => ({ renderStructuredCvPdf: vi.fn(async () => Buffer.from('%PDF')) }));
vi.mock('@/lib/storage/blob', () => ({
  downloadArtifact: vi.fn(async () => null),
  uploadArtifactBinary: vi.fn(async () => ({ bucket: 'artifacts', path: 'campagnes/CAMP-2026-293/sourcing-cv.pdf', publicUrl: null })),
}));
vi.mock('@/lib/vivier/ingest-application', () => ({ feedVivierFromApplication: vi.fn(async () => true) }));
vi.mock('@/lib/vivier/match-application', () => ({ matchVivierApplication: vi.fn(async () => true) }));

import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { canInviteForCampaign } from '@/lib/agents/server/interview-mail';
import { getCandidateAnalysis, persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
import { completeAdmission, recordAdmissionFailure, releaseSubmission, settleManifestedProfile } from '@/lib/db/repos/sourcing-admission';
import { dispatchCandidateOutreach } from '@/lib/imap/outreach';
import { admissionRetryDue, approachIdOfAnalysis, forceAcceptedApplication } from '@/lib/sourcing/admission';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';
import type { CVApplication } from '@/types/cv-analysis';

describe('règles pures', () => {
  it('zone forcée à l’acceptation, score inchangé, coordonnées de la page', () => {
    const out = forceAcceptedApplication(analyzed as unknown as CVApplication, submission);
    expect(out.scoringResult).toMatchObject({ status: 'accepted', decisionZone: 'auto_accept', totalScore: 41 });
    expect(out.candidate).toMatchObject({ fullName: 'Claire Martin', email: 'claire.martin@exemple.fr', phone: '06 12 34 56 78' });
  });

  it('identifiant d’analyse ⇄ approche', () => {
    expect(approachIdOfAnalysis(`can_src_${APPROACH_ID}`)).toBe(APPROACH_ID);
    expect(approachIdOfAnalysis('can_imap_m1_12')).toBeNull();
  });

  it('reprise : 1, 5, 15 minutes puis toutes les heures, jamais d’abandon', () => {
    const at = (min: number) => new Date(Date.parse('2026-09-14T10:00:00Z') + min * 60_000);
    expect(admissionRetryDue(1, '2026-09-14T10:00:00Z', at(0.5))).toBe(false);
    expect(admissionRetryDue(1, '2026-09-14T10:00:00Z', at(1))).toBe(true);
    expect(admissionRetryDue(3, '2026-09-14T10:00:00Z', at(14))).toBe(false);
    expect(admissionRetryDue(9, '2026-09-14T10:00:00Z', at(60))).toBe(true);
  });
});

describe('admission', () => {
  it('nominal : une analyse, décision humaine du recruteur, envoi par les clés sourcing, profil soldé', async () => {
    const out = await admitSourcedCandidate(pending);
    expect(out).toEqual({ kind: 'admitted', analysisId: `can_src_${APPROACH_ID}`, recruiterName: 'Jane R.' });
    const persisted = vi.mocked(persistCandidateAnalysisStrict).mock.calls[0]![0];
    expect(persisted).toMatchObject({ id: `can_src_${APPROACH_ID}`, uid: `can_src_${APPROACH_ID}`, decidedBy: 'user', decidedByUser: { id: 'u1', email: 'jane@cabinet.fr' } });
    expect(persisted.application.scoringResult.decisionZone).toBe('auto_accept');
    expect(vi.mocked(analyzeCVApplication).mock.calls[0]![0]).toMatchObject({ source: 'sourcing' });
    const [input, keys] = vi.mocked(dispatchCandidateOutreach).mock.calls[0]!;
    expect(keys).toEqual({ analysisId: `can_src_${APPROACH_ID}`, claim: { mailboxId: 'sourcing', uid: APPROACH_ID }, validationPrefix: `val_src_${APPROACH_ID}`, actor: 'sourcing' });
    expect(input.candidate).toMatchObject({ email: 'claire.martin@exemple.fr', decisionZone: 'auto_accept', sourcingApproach: { recruiterName: 'Jane R.' } });
    expect(input.cvArtifactId).toBe(`art_src_cv_${APPROACH_ID}`);
    expect(completeAdmission).toHaveBeenCalledWith(APPROACH_ID, `can_src_${APPROACH_ID}`);
    expect(settleManifestedProfile).toHaveBeenCalled();
  });

  it('panne d’analyse : rien de persisté, rien d’envoyé, l’approche reste en attente', async () => {
    vi.mocked(persistCandidateAnalysisStrict).mockClear();
    vi.mocked(dispatchCandidateOutreach).mockClear();
    vi.mocked(completeAdmission).mockClear();
    vi.mocked(analyzeCVApplication).mockRejectedValueOnce(new AnalysisUnavailableError('verdicts KO'));
    const out = await admitSourcedCandidate(pending);
    expect(out.kind).toBe('deferred');
    expect(persistCandidateAnalysisStrict).not.toHaveBeenCalled();
    expect(dispatchCandidateOutreach).not.toHaveBeenCalled();
    expect(completeAdmission).not.toHaveBeenCalled();
    expect(recordAdmissionFailure).toHaveBeenCalled();
  });

  it('reprise après une analyse déjà persistée : on la relit, on ne la refait pas', async () => {
    vi.mocked(analyzeCVApplication).mockClear();
    vi.mocked(getCandidateAnalysis).mockResolvedValueOnce({ application: forceAcceptedApplication(analyzed as unknown as CVApplication, submission) } as never);
    const out = await admitSourcedCandidate({ ...pending, admissionAttempts: 1 });
    expect(out.kind).toBe('admitted');
    expect(analyzeCVApplication).not.toHaveBeenCalled();
  });

  it('offre fermée entre-temps, ou invitation impossible : réservation relâchée, rien d’autre', async () => {
    vi.mocked(dispatchCandidateOutreach).mockClear();
    vi.mocked(canInviteForCampaign).mockResolvedValueOnce(false);
    expect((await admitSourcedCandidate(pending)).kind).toBe('closed');
    expect(releaseSubmission).toHaveBeenCalledWith(APPROACH_ID);
    expect(dispatchCandidateOutreach).not.toHaveBeenCalled();
  });
});
