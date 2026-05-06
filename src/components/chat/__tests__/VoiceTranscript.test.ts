import { describe, expect, it } from 'vitest';

import { formatDuration } from '@/components/chat/VoiceTranscript';

describe('formatDuration', () => {
  it('renders 0 ms as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('clamps negative values at 0', () => {
    expect(formatDuration(-500)).toBe('0:00');
  });

  it('truncates fractional seconds toward 0', () => {
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(1999)).toBe('0:01');
  });

  it('zero-pads the seconds field', () => {
    expect(formatDuration(5000)).toBe('0:05');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(125_000)).toBe('2:05');
  });

  it('handles minutes greater than 9', () => {
    expect(formatDuration(60_000 * 12 + 7000)).toBe('12:07');
  });
});
