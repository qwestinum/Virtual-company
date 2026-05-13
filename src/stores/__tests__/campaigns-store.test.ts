import { beforeEach, describe, expect, it } from 'vitest';

import { useCampaignsStore } from '@/stores/campaigns-store';
import { buildEmptyFDP } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

function makeFDP(id: string, validated = false) {
  const fdp = buildEmptyFDP(id);
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: 'Comptable senior',
    status: 'filled',
  };
  if (validated) {
    fdp.isComplete = true;
    fdp.isValidated = true;
  }
  return fdp;
}

describe('campaigns-store', () => {
  beforeEach(() => {
    useCampaignsStore.getState().reset();
  });

  it('addCampaign derives draft status from a non-validated FDP', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-001') });
    expect(c.status).toBe('draft');
  });

  it('addCampaign derives in_progress status from a validated FDP', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-002', true) });
    expect(c.status).toBe('in_progress');
  });

  it('addCampaign preserves the existing status when re-adding the same id', () => {
    const fdp = makeFDP('CAMP-2026-003', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore
      .getState()
      .updateStatus('CAMP-2026-003', 'active');
    // Re-add (cas du wipe sur une campagne déjà active).
    useCampaignsStore.getState().addCampaign({ fdp });
    expect(useCampaignsStore.getState().getById('CAMP-2026-003')?.status).toBe(
      'active',
    );
  });

  it('addCampaign accepts an explicit status override', () => {
    const fdp = makeFDP('CAMP-2026-004');
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, status: 'closed' });
    expect(useCampaignsStore.getState().getById('CAMP-2026-004')?.status).toBe(
      'closed',
    );
  });

  it('updateStatus mutates the entry and bumps updatedAt', async () => {
    const fdp = makeFDP('CAMP-2026-005', true);
    const before = useCampaignsStore.getState().addCampaign({ fdp });
    // Petit délai pour s'assurer que updatedAt change (ms granularity).
    await new Promise((r) => setTimeout(r, 5));
    useCampaignsStore.getState().updateStatus('CAMP-2026-005', 'closed');
    const after = useCampaignsStore.getState().getById('CAMP-2026-005');
    expect(after?.status).toBe('closed');
    expect(after?.updatedAt).not.toBe(before.updatedAt);
    // createdAt préservé.
    expect(after?.createdAt).toBe(before.createdAt);
  });

  it('updateStatus is a no-op when the id is unknown', () => {
    useCampaignsStore.getState().updateStatus('CAMP-NOPE', 'closed');
    expect(Object.keys(useCampaignsStore.getState().byId)).toHaveLength(0);
  });

  it('addCampaign stores the optional scoringSheet snapshot', () => {
    const fdp = makeFDP('CAMP-2026-006', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-006',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-006')?.scoringSheet
        ?.criteria,
    ).toHaveLength(1);
  });

  it('addCampaign preserves an existing scoringSheet when input is undefined', () => {
    const fdp = makeFDP('CAMP-2026-007', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-007',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    // Second appel sans scoringSheet ne doit PAS l'effacer.
    useCampaignsStore.getState().addCampaign({ fdp });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-007')?.scoringSheet,
    ).not.toBeNull();
  });

  it('markPublishedChannel is idempotent and bumps updatedAt', async () => {
    const fdp = makeFDP('CAMP-2026-PUB', true);
    const before = useCampaignsStore.getState().addCampaign({ fdp });
    await new Promise((r) => setTimeout(r, 5));
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-PUB', 'linkedin');
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-PUB', 'linkedin');
    const after = useCampaignsStore.getState().getById('CAMP-2026-PUB');
    expect(after?.publishedChannels).toEqual(['linkedin']);
    expect(after?.updatedAt).not.toBe(before.updatedAt);
  });

  it('markSourcesConfirmed flips the flag once', () => {
    const fdp = makeFDP('CAMP-2026-SRC', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().markSourcesConfirmed('CAMP-2026-SRC');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-SRC')?.sourcesConfirmed,
    ).toBe(true);
  });

  it('recomputeStatus stays draft when FDP is not validated', () => {
    const fdp = makeFDP('CAMP-2026-REC1', false);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC1');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC1')?.status,
    ).toBe('draft');
  });

  it('recomputeStatus → in_progress when FDP validated but artefacts missing', () => {
    const fdp = makeFDP('CAMP-2026-REC2', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC2');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC2')?.status,
    ).toBe('in_progress');
  });

  it('recomputeStatus → active when FDP + ad + sources + scoring all aligned', () => {
    const fdp = makeFDP('CAMP-2026-REC3', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-REC3',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-REC3', 'linkedin');
    useCampaignsStore.getState().markSourcesConfirmed('CAMP-2026-REC3');
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC3');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC3')?.status,
    ).toBe('active');
  });

  it('recomputeStatus does NOT override paused or closed', () => {
    const fdp = makeFDP('CAMP-2026-REC4', true);
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().updateStatus('CAMP-2026-REC4', 'paused');
    useCampaignsStore
      .getState()
      .markPublishedChannel('CAMP-2026-REC4', 'linkedin');
    useCampaignsStore.getState().markSourcesConfirmed('CAMP-2026-REC4');
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC4');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC4')?.status,
    ).toBe('paused');
    useCampaignsStore.getState().updateStatus('CAMP-2026-REC4', 'closed');
    useCampaignsStore.getState().recomputeStatus('CAMP-2026-REC4');
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-REC4')?.status,
    ).toBe('closed');
  });

  it('addCampaign sets scoringSheet to null explicitly when null is passed', () => {
    const fdp = makeFDP('CAMP-2026-008', true);
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-2026-008',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      ],
    };
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: sheet });
    useCampaignsStore
      .getState()
      .addCampaign({ fdp, scoringSheet: null });
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-008')?.scoringSheet,
    ).toBeNull();
  });

  it('addCampaign initialise le seuil par défaut à 75', () => {
    const c = useCampaignsStore
      .getState()
      .addCampaign({ fdp: makeFDP('CAMP-2026-100') });
    expect(c.threshold).toBe(75);
  });

  it('setThreshold borne la valeur entre 0 et 100', () => {
    const fdp = makeFDP('CAMP-2026-101');
    useCampaignsStore.getState().addCampaign({ fdp });
    useCampaignsStore.getState().setThreshold('CAMP-2026-101', 150);
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-101')?.threshold,
    ).toBe(100);
    useCampaignsStore.getState().setThreshold('CAMP-2026-101', -10);
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-101')?.threshold,
    ).toBe(0);
  });

  it('setThreshold met à jour updatedAt seulement quand la valeur change', () => {
    const fdp = makeFDP('CAMP-2026-102');
    useCampaignsStore.getState().addCampaign({ fdp });
    const before = useCampaignsStore
      .getState()
      .getById('CAMP-2026-102')!.updatedAt;
    useCampaignsStore.getState().setThreshold('CAMP-2026-102', 75);
    // identique → updatedAt inchangé
    expect(
      useCampaignsStore.getState().getById('CAMP-2026-102')!.updatedAt,
    ).toBe(before);
  });
});
