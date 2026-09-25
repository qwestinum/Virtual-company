import { describe, expect, it } from 'vitest';

import { ledgerModelFromEnv } from '@/lib/ai/ledger-model';

describe('mode hybride — modèle du relevé de faits', () => {
  it('absent ou vide ⇒ rien ne change', () => {
    expect(ledgerModelFromEnv({})).toBeUndefined();
    expect(ledgerModelFromEnv({ CV_ANALYZER_LEDGER_MODEL: '  ' })).toBeUndefined();
  });
  it('posé ⇒ le relevé part sur ce modèle (fournisseur OpenAI, explicite ou par défaut)', () => {
    expect(ledgerModelFromEnv({ CV_ANALYZER_LEDGER_MODEL: 'gpt-4o-mini' })).toBe('gpt-4o-mini');
    expect(ledgerModelFromEnv({ CV_ANALYZER_LEDGER_MODEL: 'gpt-4o-mini', CV_ANALYZER_PROVIDER: 'OpenAI' })).toBe('gpt-4o-mini');
  });
  it('ignoré en mode Anthropic : un nom de modèle OpenAI n’y partirait pas', () => {
    expect(ledgerModelFromEnv({ CV_ANALYZER_LEDGER_MODEL: 'gpt-4o-mini', CV_ANALYZER_PROVIDER: 'anthropic' })).toBeUndefined();
  });
});
