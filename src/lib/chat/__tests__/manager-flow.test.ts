import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chat/api-client', () => ({
  postJobWriter: vi.fn(),
  postCVAnalyzer: vi.fn(),
  postManagerChat: vi.fn(),
  postIsolatedManagerChat: vi.fn(),
  postTranscribe: vi.fn(),
}));

import {
  postCVAnalyzer,
  postJobWriter,
  type CVAnalyzerResult,
  type JobWriterResult,
} from '@/lib/chat/api-client';
import {
  chooseExistingCampaign,
  chooseRouteIsolated,
  chooseRouteNewCampaign,
  dispatchCVBatch,
  dispatchCVRouting,
  dispatchJobWriter,
} from '@/lib/chat/manager-flow';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import { useChatStore } from '@/stores/chat-store';
import { useFdpStore } from '@/stores/fdp-store';
import { useIsolatedCriteriaStore } from '@/stores/isolated-criteria-store';
import { useScoringStore } from '@/stores/scoring-store';
import type { CVApplication } from '@/types/cv-analysis';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

const postJobWriterMock = vi.mocked(postJobWriter);
const postCVAnalyzerMock = vi.mocked(postCVAnalyzer);

function makeFDP(id = 'CAMP-2026-007'): FDPInProgress {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title,
    status: 'filled',
    value: 'Comptable',
  };
  fdp.fields.seniority = {
    ...fdp.fields.seniority,
    status: 'filled',
    value: 'senior',
  };
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

function fakeJobWriterResult(): JobWriterResult {
  return {
    ad: {
      title: 'Comptable senior — Paris (CDI)',
      body: '# Body content',
      tags: ['Comptabilité', 'Paris'],
    },
    markdown: '# Comptable senior — Paris (CDI)\n\nBody content',
    fileName: 'annonce-comptable-senior-paris.md',
    metrics: { durationMs: 4000, tokensUsed: 500, costEstimate: 0.01 },
  };
}

function fakeCVResult(
  fileName: string,
  score = 80,
  aboveThreshold = true,
): CVAnalyzerResult {
  const application: CVApplication = {
    candidate: {
      fullName: `Candidat ${fileName}`,
      email: null,
      phone: null,
      detectedLanguage: 'fr',
      fileName,
      source: 'manual',
      receivedAt: '2026-06-06T00:00:00.000Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore: score,
      status: aboveThreshold ? 'accepted' : 'rejected',
      breakdown: [],
      hardFailures: [],
      criteriaVersion: 'v1',
      computedAt: '2026-06-06T00:00:00.000Z',
    },
    narration: {
      summary: 'Synthèse',
      strengths: ['Expérience'],
      weaknesses: [],
      justification: 'Verdict factice pour test',
    },
  };
  return {
    application,
    threshold: 75,
    metrics: { durationMs: 2500, tokensUsed: 1000, costEstimate: 0.005 },
  };
}

function makeFile(name: string, content = 'CV content for ' + name): File {
  return new File([content], name, { type: 'text/plain' });
}

function resetAll() {
  useChatStore.getState().reset();
  useAgentsStore.getState().resetToRegistry();
  useArtifactsStore.getState().reset();
  useCampaignsStore.getState().reset();
  useFdpStore.getState().reset();
  useIsolatedCriteriaStore.getState().reset();
  useScoringStore.getState().reset();
}

function validatedSheet(campaignId: string): ScoringSheet {
  return {
    campaignId,
    isValidated: true,
    acceptanceThreshold: 75,
    criteria: [
      buildCriterion({ id: 'ko', label: 'Diplôme', level: 'redhibitoire' }),
      buildCriterion({ id: 's1', label: 'IFRS', level: 'critique', weight: 8 }),
    ],
  };
}

describe('manager-flow — dispatchJobWriter', () => {
  beforeEach(() => {
    postJobWriterMock.mockReset();
    postCVAnalyzerMock.mockReset();
    resetAll();
  });

  it('posts intro + attachment but no longer the source picker (Phase 3.2)', async () => {
    // Depuis Phase 3.2, c'est handleChannelsConfirm qui pose le
    // cv-sources-picker UNE FOIS, après le loop dispatch des annonces.
    // dispatchJobWriter ne s'en occupe plus.
    postJobWriterMock.mockResolvedValueOnce(fakeJobWriterResult());
    const fdp = makeFDP('CAMP-2026-007');

    await dispatchJobWriter(fdp);

    const messages = useChatStore.getState().messages;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(
      messages.some((m) => m.attachment?.label.includes('Annonce')),
    ).toBe(true);
    expect(
      messages.some(
        (m) =>
          m.block?.kind === 'cv-sources-picker' ||
          m.block?.kind === 'source-picker',
      ),
    ).toBe(false);
    expect(Object.keys(useArtifactsStore.getState().byId)).toHaveLength(1);
  });

  it('posts a clean error bubble when the API fails', async () => {
    postJobWriterMock.mockRejectedValueOnce(new Error('OpenAI down'));
    await dispatchJobWriter(makeFDP());
    const messages = useChatStore.getState().messages;
    expect(messages.some((m) => m.content.includes('OpenAI down'))).toBe(true);
    expect(messages.some((m) => m.attachment !== undefined)).toBe(false);
  });
});

describe('manager-flow — dispatchCVBatch', () => {
  beforeEach(() => {
    postCVAnalyzerMock.mockReset();
    resetAll();
  });

  it('runs through every CV and produces a final summary block', async () => {
    postCVAnalyzerMock
      .mockResolvedValueOnce(fakeCVResult('a.pdf', 82, true))
      .mockResolvedValueOnce(fakeCVResult('b.pdf', 60, false))
      .mockResolvedValueOnce(fakeCVResult('c.pdf', 90, true));

    await dispatchCVBatch({
      files: [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')],
      threshold: 75,
      campaignId: 'CAMP-2026-007',
    });

    expect(postCVAnalyzerMock).toHaveBeenCalledTimes(3);
    const summaryBubble = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-batch-summary');
    if (summaryBubble?.block?.kind === 'cv-batch-summary') {
      expect(summaryBubble.block.summary.total).toBe(3);
      expect(summaryBubble.block.summary.aboveThreshold).toBe(2);
    }
  });

  it('résout le seuil depuis campaign.threshold sans threshold explicite (convergence 6c)', async () => {
    useCampaignsStore.getState().addCampaign({
      fdp: buildEmptyFDP('CAMP-2026-088'),
      threshold: 88,
    });
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf', 82, false));

    await dispatchCVBatch({
      files: [makeFile('a.pdf')],
      campaignId: 'CAMP-2026-088',
      // pas de threshold explicite → résolu depuis la campagne.
    });

    expect(postCVAnalyzerMock.mock.calls[0][0].threshold).toBe(88);
  });

  it('utilise la fiche PERSISTÉE de la campagne quand aucune fiche active (post-actualisation)', async () => {
    // Simule l'état après refresh : useScoringStore vide (pas hydraté), mais la
    // campagne a sa fiche validée persistée. La garde doit envoyer cette fiche.
    useCampaignsStore.getState().addCampaign({
      fdp: buildEmptyFDP('CAMP-2026-099'),
      scoringSheet: validatedSheet('CAMP-2026-099'),
    });
    useScoringStore.getState().reset(); // pas de fiche en édition (post-refresh)
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf'));

    await dispatchCVBatch({
      files: [makeFile('a.pdf')],
      campaignId: 'CAMP-2026-099',
    });

    const sent = postCVAnalyzerMock.mock.calls[0][0].scoringSheet;
    expect(sent?.isValidated).toBe(true);
    expect(sent?.campaignId).toBe('CAMP-2026-099');
  });

  it('n’envoie pas de fiche si la campagne n’a pas de fiche validée', async () => {
    useCampaignsStore.getState().addCampaign({
      fdp: buildEmptyFDP('CAMP-2026-100'),
      // pas de scoringSheet
    });
    useScoringStore.getState().reset();
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf'));

    await dispatchCVBatch({
      files: [makeFile('a.pdf')],
      campaignId: 'CAMP-2026-100',
    });

    expect(postCVAnalyzerMock.mock.calls[0][0].scoringSheet).toBeUndefined();
  });

  it('continues on per-file failure', async () => {
    postCVAnalyzerMock
      .mockResolvedValueOnce(fakeCVResult('a.pdf', 82, true))
      .mockRejectedValueOnce(new Error('PDF illisible'))
      .mockResolvedValueOnce(fakeCVResult('c.pdf', 90, true));

    await dispatchCVBatch({
      files: [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')],
      threshold: 75,
      campaignId: 'CAMP-2026-007',
    });
    const messages = useChatStore.getState().messages;
    expect(messages.some((m) => m.content.includes('PDF illisible'))).toBe(
      true,
    );
  });
});

describe('manager-flow — CV routing', () => {
  beforeEach(() => {
    postCVAnalyzerMock.mockReset();
    resetAll();
  });

  it('dispatchCVRouting posts a route-picker block with file count', () => {
    dispatchCVRouting([makeFile('a.pdf'), makeFile('b.pdf')]);
    const last = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (last?.block?.kind === 'cv-route-picker') {
      expect(last.block.fileCount).toBe(2);
      expect(last.block.activeCampaigns).toHaveLength(0);
      expect(last.block.selected).toBeNull();
    } else {
      throw new Error('expected route-picker block');
    }
  });

  it('isolated route starts isolated criteria collection', () => {
    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    chooseRouteIsolated(routerMsg.block.pendingId);

    const iso = useIsolatedCriteriaStore.getState().criteria;
    expect(iso).not.toBeNull();
    expect(iso?.taskId).toMatch(/^TASK-\d{4}-\d{3}$/);
    const messages = useChatStore.getState().messages;
    expect(
      messages.some((m) => m.content.includes("intitulé du poste")),
    ).toBe(true);
  });

  it('existing route surfaces a campaign-picker with active campaigns', async () => {
    // Round 4 — snapshotActiveCampaigns ne propose QUE les campagnes
    // au statut `active` (en écoute de flux CV). On force ce statut
    // pour les deux fixtures. Le flux `manual` doit être actif pour
    // qu'une campagne accepte le rattachement d'un upload manuel.
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-001'),
      status: 'active',
      sources: ['manual'],
    });
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-002'),
      status: 'active',
      sources: ['manual'],
    });

    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    expect(routerMsg.block.activeCampaigns).toHaveLength(2);

    // Maintenant on simule l'utilisateur qui clique « Campagne en cours »
    // puis qui choisit la campagne CAMP-2026-001.
    const { chooseRouteExisting } = await import('@/lib/chat/manager-flow');
    chooseRouteExisting(routerMsg.block.pendingId);
    const pickerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'campaign-picker');
    if (!pickerMsg || pickerMsg.block?.kind !== 'campaign-picker')
      throw new Error('no campaign-picker');
    expect(pickerMsg.block.campaigns).toHaveLength(2);

    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf'));
    await chooseExistingCampaign(
      pickerMsg.block.pendingId,
      'CAMP-2026-001',
    );
    expect(postCVAnalyzerMock).toHaveBeenCalledTimes(1);
    const callArg = postCVAnalyzerMock.mock.calls[0]?.[0];
    expect(callArg?.campaignId).toBe('CAMP-2026-001');
  });

  it('excludes campaigns without a manual flow from the upload pickers', async () => {
    // Campagne en réception automatique seule (boîte mail générique) :
    // y déposer un CV à la main contredirait le flux choisi → elle ne
    // doit apparaître ni dans le route-picker ni dans le campaign-picker.
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-010'),
      status: 'active',
      sources: ['email'],
    });
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-011'),
      status: 'active',
      sources: ['manual', 'email'],
    });

    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    expect(routerMsg.block.activeCampaigns).toHaveLength(1);
    expect(routerMsg.block.activeCampaigns[0]?.id).toBe('CAMP-2026-011');

    const { chooseRouteExisting } = await import('@/lib/chat/manager-flow');
    chooseRouteExisting(routerMsg.block.pendingId);
    const pickerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'campaign-picker');
    if (!pickerMsg || pickerMsg.block?.kind !== 'campaign-picker')
      throw new Error('no campaign-picker');
    expect(pickerMsg.block.campaigns).toHaveLength(1);
    expect(pickerMsg.block.campaigns[0]?.id).toBe('CAMP-2026-011');

    // Garde-fou flow : même forcé sur la campagne email-only, aucun batch.
    await chooseExistingCampaign(routerMsg.block.pendingId, 'CAMP-2026-010');
    expect(postCVAnalyzerMock).not.toHaveBeenCalled();
  });

  it('new campaign route creates the campaign + FDP directly (no name step)', () => {
    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');

    const campaignId = chooseRouteNewCampaign(routerMsg.block.pendingId);

    // Pas de notion de nom de campagne → on NE demande PAS de nom.
    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.content.includes('Quel nom')),
    ).toBe(false);

    // Une FDP vide est créée directement sous la CAMP-XXXX retournée, et la
    // modalité isolée (« Cadrer / Juste l'analyse ») n'est jamais proposée.
    expect(campaignId).toMatch(/^CAMP-\d{4}-\d{3}$/);
    const fdp = useFdpStore.getState().fdp;
    expect(fdp).not.toBeNull();
    expect(fdp?.campaignId).toBe(campaignId);
    expect(
      useChatStore
        .getState()
        .messages.some((m) =>
          (m.chips?.options ?? []).includes('Cadrer la fiche complète'),
        ),
    ).toBe(false);
    expect(useIsolatedCriteriaStore.getState().criteria).toBeNull();
  });
});

// Note : `dispatchIsolatedCVBatch` (analyse CV en mode tâche isolée) a été retiré
// en 6e — la modalité isolée est désactivée en v1 et incompatible avec le scoring
// par fiche obligatoire (câblage à reconstruire, cf. backlog).
