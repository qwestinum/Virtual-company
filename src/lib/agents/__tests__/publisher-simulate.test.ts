import { describe, expect, it } from 'vitest';

import {
  renderPublicationProofMarkdown,
  simulatePublication,
} from '@/lib/agents/publisher-simulate';

describe('simulatePublication', () => {
  it('produces a proof with a recognizable URL for each known channel', () => {
    const expectations: Record<string, RegExp> = {
      linkedin: /linkedin\.com\/jobs\/view\//,
      indeed: /indeed\.com\/viewjob/,
      welcome_to_the_jungle: /welcometothejungle\.com/,
      apec: /apec\.fr/,
      france_travail: /francetravail\.fr/,
      generic: /qwestinum\.com\/jobs\//,
    };
    for (const [channel, re] of Object.entries(expectations)) {
      const proof = simulatePublication(channel as never);
      expect(proof.channel).toBe(channel);
      expect(proof.url).toMatch(re);
      expect(proof.postId.length).toBeGreaterThan(8);
      expect(new Date(proof.publishedAt).getTime()).toBeGreaterThan(0);
    }
  });

  it('two calls produce two distinct postIds', () => {
    const a = simulatePublication('linkedin');
    const b = simulatePublication('linkedin');
    expect(a.postId).not.toBe(b.postId);
  });
});

describe('renderPublicationProofMarkdown', () => {
  it('contains channel, URL, postId and timestamp', () => {
    const proof = simulatePublication('indeed');
    const md = renderPublicationProofMarkdown(proof);
    expect(md).toContain('# Preuve de publication — Indeed');
    expect(md).toContain(proof.url);
    expect(md).toContain(proof.postId);
    expect(md).toContain('publication simulée');
  });
});
