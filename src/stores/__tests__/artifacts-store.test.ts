import { beforeEach, describe, expect, it } from 'vitest';

import { useArtifactsStore } from '@/stores/artifacts-store';

describe('artifacts-store (Session 4)', () => {
  beforeEach(() => {
    useArtifactsStore.getState().reset();
  });

  it('starts empty', () => {
    expect(Object.keys(useArtifactsStore.getState().byId)).toHaveLength(0);
  });

  it('addArtifact returns a unique id and stores it', () => {
    const a = useArtifactsStore.getState().addArtifact({
      name: 'annonce.md',
      mime: 'text/markdown',
      content: '# Test',
    });
    expect(a.id).toMatch(/^art_/);
    expect(useArtifactsStore.getState().byId[a.id]).toMatchObject({
      name: 'annonce.md',
      mime: 'text/markdown',
      content: '# Test',
    });
  });

  it('getArtifact returns undefined for unknown id', () => {
    expect(useArtifactsStore.getState().getArtifact('nope')).toBeUndefined();
  });

  it('reset empties the store', () => {
    useArtifactsStore
      .getState()
      .addArtifact({ name: 'a.md', mime: 'text/markdown', content: 'x' });
    useArtifactsStore.getState().reset();
    expect(Object.keys(useArtifactsStore.getState().byId)).toHaveLength(0);
  });

  it('two adds produce different ids', () => {
    const a = useArtifactsStore
      .getState()
      .addArtifact({ name: 'a.md', mime: 'text/markdown', content: '1' });
    const b = useArtifactsStore
      .getState()
      .addArtifact({ name: 'b.md', mime: 'text/markdown', content: '2' });
    expect(a.id).not.toBe(b.id);
  });
});
