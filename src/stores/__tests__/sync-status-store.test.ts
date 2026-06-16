import { beforeEach, describe, expect, it } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import {
  selectFailedCount,
  useSyncStatusStore,
} from '@/stores/sync-status-store';

function snap(id: string, name = id): ActiveCampaign {
  return { id, name } as unknown as ActiveCampaign;
}

describe('sync-status-store', () => {
  beforeEach(() => {
    useSyncStatusStore.getState().reset();
  });

  it('markCampaignFailed enregistre le snapshot par id', () => {
    useSyncStatusStore.getState().markCampaignFailed(snap('CAMP-1', 'Dev'));
    expect(useSyncStatusStore.getState().failedList()).toHaveLength(1);
    expect(selectFailedCount(useSyncStatusStore.getState())).toBe(1);
  });

  it('markCampaignFailed garde le snapshot le PLUS RÉCENT pour un id', () => {
    useSyncStatusStore.getState().markCampaignFailed(snap('CAMP-1', 'V1'));
    useSyncStatusStore.getState().markCampaignFailed(snap('CAMP-1', 'V2'));
    const list = useSyncStatusStore.getState().failedList();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('V2');
  });

  it('clearCampaignFailed lève le drapeau (no-op si absent)', () => {
    useSyncStatusStore.getState().markCampaignFailed(snap('CAMP-1'));
    useSyncStatusStore.getState().clearCampaignFailed('CAMP-1');
    expect(useSyncStatusStore.getState().failedList()).toHaveLength(0);
    // No-op sur id inconnu.
    useSyncStatusStore.getState().clearCampaignFailed('CAMP-INCONNU');
    expect(selectFailedCount(useSyncStatusStore.getState())).toBe(0);
  });
});
