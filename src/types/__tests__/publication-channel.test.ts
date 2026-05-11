import { describe, expect, it } from 'vitest';

import {
  channelFromLabel,
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  PUBLICATION_CHANNELS,
} from '@/types/publication-channel';

describe('publication-channel', () => {
  it('every channel has a label and appears in the canonical order', () => {
    for (const channel of PUBLICATION_CHANNELS) {
      expect(PUBLICATION_CHANNEL_LABELS[channel]).toBeTruthy();
      expect(PUBLICATION_CHANNEL_ORDER).toContain(channel);
    }
  });

  it('channelFromLabel resolves each canonical label back to its enum', () => {
    for (const channel of PUBLICATION_CHANNELS) {
      const label = PUBLICATION_CHANNEL_LABELS[channel];
      expect(channelFromLabel(label)).toBe(channel);
    }
  });

  it('channelFromLabel returns null for unknown labels', () => {
    expect(channelFromLabel('Unknown Network')).toBeNull();
    expect(channelFromLabel('')).toBeNull();
    expect(channelFromLabel('linkedin')).toBeNull(); // lowercase, exact match only
  });
});
