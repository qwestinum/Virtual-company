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

describe('définition d’un bras candidat', () => {
  it('hybride : un modèle pour le relevé, un autre pour le reste — les deux sont admis au retour', async () => {
    const { parseArmSpec, allowedModels } = await import('@/lib/model-comparison/arm-env');
    const r = parseArmSpec('hybride,model=gpt-4o,ledger=gpt-4o-mini');
    expect(r).toEqual({ name: 'hybride', settings: { provider: 'openai', model: 'gpt-4o', baseUrl: null, ledgerModel: 'gpt-4o-mini' } });
    if ('settings' in r) expect(allowedModels(r.settings)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(parseArmSpec('haiku,provider=anthropic,model=claude-haiku-4-5')).toMatchObject({ settings: { provider: 'anthropic', model: 'claude-haiku-4-5' } });
  });

  it('refuse l’incomplet et l’incohérent', async () => {
    const { parseArmSpec } = await import('@/lib/model-comparison/arm-env');
    expect(parseArmSpec('x,provider=openai')).toHaveProperty('error');
    expect(parseArmSpec('Nom Espacé,model=a')).toHaveProperty('error');
    expect(parseArmSpec('x,provider=mistral,model=a')).toHaveProperty('error');
    expect(parseArmSpec('x,provider=anthropic,model=a,base-url=https://api.mistral.ai/v1')).toHaveProperty('error');
  });
});
