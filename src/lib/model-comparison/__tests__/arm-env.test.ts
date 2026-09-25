import { describe, expect, it } from 'vitest';

import { childEnv, envMismatches, type ArmSettings } from '@/lib/model-comparison/arm-env';

const mini: ArmSettings = { provider: 'openai', model: 'gpt-4o-mini', baseUrl: null };

describe('environnement d’un bras', () => {
  it('le processus du bras porte SES réglages, pas ceux du fichier .env', () => {
    const ambient = { OPENAI_API_KEY: 'sk', OPENAI_CHAT_MODEL: 'gpt-4o', CV_ANALYZER_PROVIDER: 'anthropic', OPENAI_BASE_URL: 'https://api.mistral.ai/v1', ANTHROPIC_CHAT_MODEL: 'claude-sonnet-4-6' };
    const env = childEnv(ambient, mini);
    expect(env).toMatchObject({ OPENAI_API_KEY: 'sk', OPENAI_CHAT_MODEL: 'gpt-4o-mini', CV_ANALYZER_PROVIDER: 'openai' });
    expect('OPENAI_BASE_URL' in env).toBe(false);
    expect('ANTHROPIC_CHAT_MODEL' in env).toBe(false);
    expect(envMismatches(mini, env)).toEqual([]);
    // L'ambiant, lui, n'est pas modifié.
    expect(ambient.OPENAI_CHAT_MODEL).toBe('gpt-4o');
  });

  it('refuse de démarrer si l’environnement effectif diffère', () => {
    expect(envMismatches(mini, { CV_ANALYZER_PROVIDER: 'openai', OPENAI_CHAT_MODEL: 'gpt-4o' })).toHaveLength(1);
    expect(envMismatches(mini, { OPENAI_CHAT_MODEL: 'gpt-4o-mini' })).toHaveLength(1); // fournisseur absent
    expect(envMismatches(mini, { CV_ANALYZER_PROVIDER: 'openai', OPENAI_CHAT_MODEL: 'gpt-4o-mini', OPENAI_BASE_URL: 'https://api.mistral.ai/v1' })).toHaveLength(1);
    const compat: ArmSettings = { provider: 'openai', model: 'mistral-small-latest', baseUrl: 'https://api.mistral.ai/v1' };
    expect(envMismatches(compat, childEnv({}, compat))).toEqual([]);
  });
});
