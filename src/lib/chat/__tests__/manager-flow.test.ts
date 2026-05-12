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
  consumeNewCampaignName,
  dispatchCVBatch,
  dispatchCVRouting,
  dispatchIsolatedCVBatch,
  dispatchJobWriter,
  findPendingByResolvedId,
  newCampaignSkipSetup,
} from '@/lib/chat/manager-flow';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import { useChatStore } from '@/stores/chat-store';
import { useIsolatedCriteriaStore } from '@/stores/isolated-criteria-store';
import type { CVAnalysisResult } from '@/types/cv-analysis';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';

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
  const result: CVAnalysisResult = {
    fileName,
    candidateName: `Candidat ${fileName}`,
    email: null,
    phone: null,
    skills: ['SAP'],
    experienceYears: 5,
    score,
    summary: 'Synthèse',
    strengths: ['Expérience'],
    weaknesses: [],
    justification: 'Verdict factice pour test',
    aboveThreshold,
  };
  return {
    result,
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
  useIsolatedCriteriaStore.getState().reset();
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
      criteria: { jobTitle: 'Comptable' },
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

  it('continues on per-file failure', async () => {
    postCVAnalyzerMock
      .mockResolvedValueOnce(fakeCVResult('a.pdf', 82, true))
      .mockRejectedValueOnce(new Error('PDF illisible'))
      .mockResolvedValueOnce(fakeCVResult('c.pdf', 90, true));

    await dispatchCVBatch({
      files: [makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')],
      criteria: {},
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
    // pour les deux fixtures.
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-001'),
      status: 'active',
    });
    useCampaignsStore.getState().addCampaign({
      fdp: makeFDP('CAMP-2026-002'),
      status: 'active',
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

  it('new campaign route asks for a name then gives the setup choice', () => {
    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    chooseRouteNewCampaign(routerMsg.block.pendingId);

    expect(
      useChatStore
        .getState()
        .messages.some((m) => m.content.includes('Quel nom')),
    ).toBe(true);

    const consumed = consumeNewCampaignName('Recrutement Data 2026');
    expect(consumed).toBe(true);
    const messages = useChatStore.getState().messages;
    expect(
      messages.some((m) => m.content.includes('campagne CAMP-')),
    ).toBe(true);
    expect(
      messages.some((m) =>
        (m.chips?.options ?? []).includes('Cadrer la fiche complète'),
      ),
    ).toBe(true);
  });

  it('skip setup branch starts isolated criteria under CAMP id', () => {
    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    chooseRouteNewCampaign(routerMsg.block.pendingId);
    consumeNewCampaignName('Recrutement Data 2026');
    const skipped = newCampaignSkipSetup();
    expect(skipped).toBe(true);
    const iso = useIsolatedCriteriaStore.getState().criteria;
    expect(iso).not.toBeNull();
    expect(iso?.taskId).toMatch(/^CAMP-\d{4}-\d{3}$/);
  });
});

describe('manager-flow — dispatchIsolatedCVBatch', () => {
  beforeEach(() => {
    postCVAnalyzerMock.mockReset();
    resetAll();
  });

  it('runs the batch using the resolved id from a pending routing', async () => {
    postCVAnalyzerMock.mockResolvedValueOnce(fakeCVResult('a.pdf'));
    dispatchCVRouting([makeFile('a.pdf')]);
    const routerMsg = useChatStore
      .getState()
      .messages.find((m) => m.block?.kind === 'cv-route-picker');
    if (!routerMsg || routerMsg.block?.kind !== 'cv-route-picker')
      throw new Error('no route-picker');
    chooseRouteIsolated(routerMsg.block.pendingId);
    const taskId = useIsolatedCriteriaStore.getState().criteria?.taskId;
    expect(taskId).toBeDefined();
    if (!taskId) return;

    const pending = findPendingByResolvedId(taskId);
    expect(pending).toBeDefined();
    if (!pending) return;

    await dispatchIsolatedCVBatch({
      pendingId: pending.pendingId,
      criteria: { jobTitle: 'Data Engineer', seniority: 'senior' },
    });
    expect(postCVAnalyzerMock).toHaveBeenCalledTimes(1);
    expect(useIsolatedCriteriaStore.getState().criteria).toBeNull();
  });
});
