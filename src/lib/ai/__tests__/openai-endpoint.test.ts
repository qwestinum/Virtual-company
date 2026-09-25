import { describe, expect, it } from 'vitest';

import { isRefusedHost, resolveOpenAiEndpoint } from '@/lib/ai/openai-endpoint';

describe('point d’accès compatible OpenAI (25/09/2026)', () => {
  it('sans URL de base : OpenAI, clé OpenAI — comportement inchangé', () => {
    expect(resolveOpenAiEndpoint({ OPENAI_API_KEY: 'sk-x' })).toEqual({
      ok: true, apiKey: 'sk-x', baseURL: null, host: 'api.openai.com', thirdParty: false,
    });
    expect(resolveOpenAiEndpoint({}).ok).toBe(false);
  });

  it('tiers : sa propre clé, JAMAIS la clé OpenAI', () => {
    const env = { OPENAI_BASE_URL: 'https://api.mistral.ai/v1', OPENAI_API_KEY: 'sk-openai' };
    const r = resolveOpenAiEndpoint(env);
    expect(r.ok).toBe(false);
    const ok = resolveOpenAiEndpoint({ ...env, OPENAI_COMPATIBLE_API_KEY: 'mis-key' });
    expect(ok).toMatchObject({ ok: true, apiKey: 'mis-key', baseURL: 'https://api.mistral.ai/v1', thirdParty: true });
  });

  it('OVH et Scaleway passent ; http refusé', () => {
    const key = { OPENAI_COMPATIBLE_API_KEY: 'k' };
    expect(resolveOpenAiEndpoint({ ...key, OPENAI_BASE_URL: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1' }).ok).toBe(true);
    expect(resolveOpenAiEndpoint({ ...key, OPENAI_BASE_URL: 'https://api.scaleway.ai/v1' }).ok).toBe(true);
    expect(resolveOpenAiEndpoint({ ...key, OPENAI_BASE_URL: 'http://api.mistral.ai/v1' }).ok).toBe(false);
  });

  it('deepseek.com est refusé, sous-domaines et casse compris', () => {
    for (const u of ['https://api.deepseek.com', 'https://API.DeepSeek.com/v1', 'https://x.y.deepseek.com/v1']) {
      const r = resolveOpenAiEndpoint({ OPENAI_BASE_URL: u, OPENAI_COMPATIBLE_API_KEY: 'k' });
      expect(r.ok).toBe(false);
    }
    // Un nom qui CONTIENT la chaîne sans être le domaine n'est pas visé.
    expect(isRefusedHost('notdeepseek.com.example.org')).toBe(false);
    expect(isRefusedHost('deepseek.com.')).toBe(true);
  });
});
