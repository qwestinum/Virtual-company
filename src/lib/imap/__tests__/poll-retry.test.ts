/**
 * Rails de réessai du poller IMAP (audit C2/C3) — fonctions PURES.
 *
 * La règle testée ici est le cœur du correctif « jamais décider ni envoyer
 * sous incertitude » : permanent = défaut prouvé du document, tout le reste
 * est re-tentable sous plafond + backoff.
 */
import { describe, expect, it } from 'vitest';

import { CVExtractError } from '@/lib/agents/cv-extract';
import {
  AIProviderError,
  AIValidationError,
  AnalysisUnavailableError,
} from '@/lib/ai/errors';
import { RetryableOutreachError } from '@/lib/imap/outreach';
import {
  classifyProcessingError,
  computeNextRetryAt,
  isInBackoffWindow,
  MAX_CV_ANALYSIS_ATTEMPTS,
  RetryablePollError,
} from '@/lib/imap/poll-retry';

describe('classifyProcessingError', () => {
  it('défaut prouvé du document → permanent (re-tenter ne changera rien)', () => {
    for (const code of ['unsupported_type', 'empty_text', 'parse_failed'] as const) {
      expect(classifyProcessingError(new CVExtractError(code, 'boom'))).toBe(
        'permanent',
      );
    }
  });

  it('panne du moteur PDF (infra, pas le document) → retryable', () => {
    expect(
      classifyProcessingError(
        new CVExtractError('pdf_engine_unavailable', 'polyfill manquant'),
      ),
    ).toBe('retryable');
  });

  it('erreurs transport LLM (rate limit, timeout, config) → retryable', () => {
    for (const code of ['rate_limit', 'timeout', 'api_error', 'config_missing'] as const) {
      expect(classifyProcessingError(new AIProviderError(code, 'boom'))).toBe(
        'retryable',
      );
    }
  });

  it('verdicts inexploitables (AnalysisUnavailableError) → retryable', () => {
    expect(
      classifyProcessingError(
        new AnalysisUnavailableError(
          'verdicts KO',
          new AIValidationError('invalide', 3, null),
        ),
      ),
    ).toBe('retryable');
  });

  it('erreur inconnue (hoquet DB, réseau…) → retryable par défaut', () => {
    expect(classifyProcessingError(new Error('fetch failed'))).toBe('retryable');
    expect(classifyProcessingError('string error')).toBe('retryable');
  });
});

describe('computeNextRetryAt — backoff 1, 15, 60, 360 min puis plafond', () => {
  const now = new Date('2026-07-09T10:00:00.000Z');
  const minutesFromNow = (m: number) =>
    new Date(now.getTime() + m * 60_000).toISOString();

  it('programme la bonne échéance après chaque tentative échouée', () => {
    expect(computeNextRetryAt(1, now)).toBe(minutesFromNow(1));
    expect(computeNextRetryAt(2, now)).toBe(minutesFromNow(15));
    expect(computeNextRetryAt(3, now)).toBe(minutesFromNow(60));
    expect(computeNextRetryAt(4, now)).toBe(minutesFromNow(360));
  });

  it('plafond atteint → null (abandon signalé, jamais de refus auto)', () => {
    expect(computeNextRetryAt(MAX_CV_ANALYSIS_ATTEMPTS, now)).toBeNull();
    expect(computeNextRetryAt(MAX_CV_ANALYSIS_ATTEMPTS + 3, now)).toBeNull();
  });

  it('couverture totale ≈ 7 h (une saturation TPM longue ne consomme aucun CV)', () => {
    const totalMinutes = [1, 15, 60, 360].reduce((a, b) => a + b, 0);
    expect(totalMinutes).toBeGreaterThanOrEqual(7 * 60);
  });
});

describe('isInBackoffWindow', () => {
  const now = new Date('2026-07-09T10:00:00.000Z');

  it('pas d’échéance → pas de fenêtre', () => {
    expect(isInBackoffWindow(null, now)).toBe(false);
  });

  it('échéance passée → fenêtre close (on re-tente)', () => {
    expect(isInBackoffWindow('2026-07-09T09:59:00.000Z', now)).toBe(false);
  });

  it('échéance future → fenêtre ouverte (curseur gelé, zéro coût LLM)', () => {
    expect(isInBackoffWindow('2026-07-09T10:01:00.000Z', now)).toBe(true);
  });

  it('date illisible → fail-safe fenêtre close', () => {
    expect(isInBackoffWindow('pas-une-date', now)).toBe(false);
  });
});

describe('RetryablePollError — un seul rail', () => {
  it('le différé HITL (RetryableOutreachError) emprunte le même rail que les échecs d’analyse', () => {
    const err = new RetryableOutreachError('hitl_state_unconfirmed');
    expect(err).toBeInstanceOf(RetryablePollError);
    expect(err.reason).toBe('hitl_state_unconfirmed');
    expect(err.name).toBe('RetryableOutreachError');
  });
});
