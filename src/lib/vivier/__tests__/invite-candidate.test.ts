/**
 * « Inviter » depuis le vivier d'une campagne (point 1) — base, modèle et
 * envoi simulés. Ce qui est testé : ce que le geste écrit, ce qu'il n'écrit
 * jamais (aucune fiche de validation, aucun second scoring), et ce qu'il
 * refuse sous panne.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalysisUnavailableError } from '@/lib/ai/errors';

const CAMPAIGN = 'CAMP-2026-301';
const VIV = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ANALYSIS = `can_viv_${CAMPAIGN}_${VIV}`;

const campaign = {
  id: CAMPAIGN, status: 'active', thresholdLow: 50, thresholdHigh: 80,
  fdp: { fields: { job_title: { value: 'Business Analyst' } } },
  scoringSheet: { isValidated: true, criteria: [] },
};
const vivier = {
  id: VIV, email: 'claire.martin@exemple.fr', nom: 'Claire Martin', prenom: 'Claire', telephone: '06 00 00 00 00',
  cvPath: 'vivier/claire.pdf', cvFileName: 'claire.pdf', cvText: 'Business Analyst AMOA — 8 ans.',
  enteredAt: '2026-03-12T09:00:00Z',
};
const analyzed = {
  candidate: { fullName: 'C. M.', email: 'autre@cv.fr', phone: null, detectedLanguage: 'fr', fileName: 'claire.pdf', source: 'vivier', receivedAt: 'x', rightToWork: null, location: null, photoPresent: false },
  scoringResult: { totalScore: 62, status: 'rejected', decisionZone: 'gray', breakdown: [], hardFailures: [], criteriaVersion: 'v1', computedAt: 'x' },
  narration: { summary: 'Profil AMOA.', strengths: [], weaknesses: [], justification: 'Dans la bande.' },
};

vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn(async () => campaign) }));
vi.mock('@/lib/db/repos/vivier', () => ({ getVivierCandidate: vi.fn(async () => vivier) }));
vi.mock('@/lib/db/repos/vivier-preselection', () => ({
  getPreselectionEntry: vi.fn(),
  markContacted: vi.fn(async () => [VIV]),
  releaseInvitation: vi.fn(async () => {}),
  retakeStaleInvitation: vi.fn(async () => false),
}));
vi.mock('@/lib/agents/server/interview-mail', () => ({ canInviteForCampaign: vi.fn(async () => true) }));
vi.mock('@/lib/agents/server/cv-application-analyze', () => ({ analyzeCVApplication: vi.fn(async () => ({ application: analyzed, isCv: true })) }));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  getCandidateAnalysis: vi.fn(async () => null),
  persistCandidateAnalysisStrict: vi.fn(async () => 'inserted'),
}));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: vi.fn(async () => ({ displayName: 'Jane R.', email: 'jane@cabinet.fr' })) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/artifacts', () => ({ upsertArtifactMeta: vi.fn(async () => {}) }));
vi.mock('@/lib/imap/outreach', () => {
  class RetryableOutreachError extends Error {}
  return { dispatchCandidateOutreach: vi.fn(async () => ({ kind: 'sent' })), RetryableOutreachError };
});
vi.mock('@/lib/storage/blob', () => ({
  downloadArtifact: vi.fn(async () => Buffer.from('%PDF')),
  uploadArtifactBinary: vi.fn(async () => ({ bucket: 'artifacts', path: `campagnes/${CAMPAIGN}/vivier-cv.pdf`, publicUrl: null })),
}));
vi.mock('@/lib/vivier/last-applied-job', () => ({
  resolveLastAppliedJobs: vi.fn(async () => new Map([['claire.martin@exemple.fr', { jobTitle: 'Chef de projet MOA', at: '2026-03-12T09:00:00Z' }]])),
}));

import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { getCandidateAnalysis, persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
import { upsertArtifactMeta } from '@/lib/db/repos/artifacts';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getPreselectionEntry, markContacted, releaseInvitation } from '@/lib/db/repos/vivier-preselection';
import { dispatchCandidateOutreach } from '@/lib/imap/outreach';
import { inviteVivierCandidate } from '@/lib/vivier/invite-candidate';

const actor = { id: 'u1', email: 'jane@cabinet.fr' };
const identified = { state: 'identified' as const, generatedAt: '2026-09-20T08:00:00Z', contactedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPreselectionEntry)
    .mockResolvedValueOnce(identified)
    .mockResolvedValue({ ...identified, state: 'contacted', contactedAt: '2026-09-28T10:00:00Z' });
});

describe('inviter un profil du vivier', () => {
  it('crée UNE candidature : source vivier, décision humaine, zone acceptée, origine tracée', async () => {
    const out = await inviteVivierCandidate({ campaignId: CAMPAIGN, vivierCandidateId: VIV, actor });
    expect(out).toEqual({ kind: 'invited', analysisId: ANALYSIS, mail: 'sent', created: true });
    const persisted = vi.mocked(persistCandidateAnalysisStrict).mock.calls[0]![0];
    expect(persisted).toMatchObject({
      id: ANALYSIS, uid: ANALYSIS, campaignId: CAMPAIGN, decidedBy: 'user',
      decidedByUser: { id: 'u1', email: 'jane@cabinet.fr' }, fromVivier: { vivierCandidateId: VIV },
    });
    // Score et verdicts INCHANGÉS, décision posée par l'humain.
    expect(persisted.application.scoringResult).toMatchObject({ totalScore: 62, status: 'accepted', decisionZone: 'auto_accept' });
    // Coordonnées du dossier vivier, pas celles de l'extraction.
    expect(persisted.application.candidate).toMatchObject({ fullName: 'Claire Martin', email: 'claire.martin@exemple.fr', source: 'vivier' });
    expect(persisted.application.vivierOrigin).toMatchObject({
      vivierCandidateId: VIV, cvDateKind: 'application', previousJobTitle: 'Chef de projet MOA',
      proposedAt: '2026-09-20T08:00:00Z', invitedBy: { id: 'u1', name: 'Jane R.' },
    });
    // Le CV est COPIÉ sous la campagne (art_viv_*) et joint à l'invitation.
    expect(vi.mocked(upsertArtifactMeta).mock.calls[0]![0]).toMatchObject({ id: `art_viv_cv_${CAMPAIGN}_${VIV}`, campaignId: CAMPAIGN, kind: 'cv' });
    const [input, keys] = vi.mocked(dispatchCandidateOutreach).mock.calls[0]!;
    expect(input.candidate.decisionZone).toBe('auto_accept');
    expect(input.cvArtifactId).toBe(`art_viv_cv_${CAMPAIGN}_${VIV}`);
    expect(keys).toEqual({ analysisId: ANALYSIS, claim: { mailboxId: 'vivier', uid: ANALYSIS }, actor: 'user' });
    // Compteurs de campagne + trace propre, AVANT l'envoi.
    const actions = vi.mocked(appendJournalEntry).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['imap_cv_received', 'imap_cv_analyzed', 'candidate_created_from_vivier']);
    const created = vi.mocked(appendJournalEntry).mock.calls[2]![0];
    expect(created.payload).toEqual({ uid: ANALYSIS, analysisId: ANALYSIS, campaignId: CAMPAIGN, vivierId: VIV, recruiterId: 'u1' });
  });

  it('second clic pendant le premier : aucune seconde analyse, aucun envoi', async () => {
    vi.mocked(markContacted).mockResolvedValueOnce([]);
    const out = await inviteVivierCandidate({ campaignId: CAMPAIGN, vivierCandidateId: VIV, actor });
    expect(out).toEqual({ kind: 'refused', reason: 'in_progress' });
    expect(analyzeCVApplication).not.toHaveBeenCalled();
    expect(dispatchCandidateOutreach).not.toHaveBeenCalled();
  });

  it('reprise après une candidature déjà créée : pas de second scoring, l’envoi tient ses verrous', async () => {
    vi.mocked(getCandidateAnalysis).mockResolvedValueOnce({ application: { ...analyzed, vivierOrigin: undefined } } as never);
    vi.mocked(dispatchCandidateOutreach).mockResolvedValueOnce({ kind: 'duplicate' });
    const out = await inviteVivierCandidate({ campaignId: CAMPAIGN, vivierCandidateId: VIV, actor });
    expect(out).toEqual({ kind: 'invited', analysisId: ANALYSIS, mail: 'duplicate', created: false });
    expect(analyzeCVApplication).not.toHaveBeenCalled();
    expect(persistCandidateAnalysisStrict).not.toHaveBeenCalled();
  });

  it('analyse indisponible : réservation relâchée, rien de créé ni d’envoyé', async () => {
    vi.mocked(analyzeCVApplication).mockRejectedValueOnce(new AnalysisUnavailableError('verdicts KO'));
    const out = await inviteVivierCandidate({ campaignId: CAMPAIGN, vivierCandidateId: VIV, actor });
    expect(out).toEqual({ kind: 'refused', reason: 'analysis_unavailable' });
    expect(releaseInvitation).toHaveBeenCalledWith(CAMPAIGN, VIV, '2026-09-28T10:00:00Z');
    expect(persistCandidateAnalysisStrict).not.toHaveBeenCalled();
    expect(dispatchCandidateOutreach).not.toHaveBeenCalled();
  });

  it('profil écarté : rien ne se passe', async () => {
    vi.mocked(getPreselectionEntry).mockReset().mockResolvedValue({ ...identified, state: 'rejected' });
    const out = await inviteVivierCandidate({ campaignId: CAMPAIGN, vivierCandidateId: VIV, actor });
    expect(out).toEqual({ kind: 'refused', reason: 'already_decided' });
    expect(markContacted).not.toHaveBeenCalled();
    expect(dispatchCandidateOutreach).not.toHaveBeenCalled();
  });
});
