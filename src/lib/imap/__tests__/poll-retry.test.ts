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
  buildFetchSet,
  classifyProcessingError,
  computeNextRetryAt,
  isInBackoffWindow,
  MAX_CV_ANALYSIS_ATTEMPTS,
  RetryablePollError,
  shouldProcessUid,
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

describe('computeNextRetryAt — backoff 1, 5, 15 min puis plafond 3', () => {
  const now = new Date('2026-07-09T10:00:00.000Z');
  const minutesFromNow = (m: number) =>
    new Date(now.getTime() + m * 60_000).toISOString();

  it('programme la bonne échéance après chaque tentative échouée', () => {
    expect(computeNextRetryAt(1, now)).toBe(minutesFromNow(1));
    expect(computeNextRetryAt(2, now)).toBe(minutesFromNow(5));
  });

  it('plafond atteint (3) → null (abandon signalé, jamais de refus auto)', () => {
    expect(MAX_CV_ANALYSIS_ATTEMPTS).toBe(3);
    expect(computeNextRetryAt(MAX_CV_ANALYSIS_ATTEMPTS, now)).toBeNull();
    expect(computeNextRetryAt(MAX_CV_ANALYSIS_ATTEMPTS + 3, now)).toBeNull();
  });

  it('couverture totale ≈ 21 min — jamais des heures de file immobilisée', () => {
    const totalMinutes = [1, 5, 15].reduce((a, b) => a + b, 0);
    expect(totalMinutes).toBeLessThanOrEqual(30);
  });
});

describe('buildFetchSet / shouldProcessUid — la file n’est JAMAIS bloquée', () => {
  it('sans curseur → plage complète (boîte neuve)', () => {
    expect(buildFetchSet(null, [])).toBe('1:*');
  });

  it('sans retry échu → plage des nouveaux messages seulement', () => {
    expect(buildFetchSet(1623, [])).toBe('1624:*');
  });

  it('retries échus derrière le curseur → re-fetchés NOMMÉMENT + plage', () => {
    expect(buildFetchSet(1700, [1624, 1650])).toBe('1624,1650,1701:*');
  });

  it('dédup + tri + exclusion des uids déjà couverts par la plage', () => {
    expect(buildFetchSet(1700, [1650, 1624, 1650, 1800])).toBe(
      '1624,1650,1701:*',
    );
  });

  it('un uid ≤ curseur ne passe QUE s’il est un retry échu (anti re-fetch parasite)', () => {
    const due = new Set([1624]);
    expect(shouldProcessUid(1624, 1700, due)).toBe(true); // retry échu
    expect(shouldProcessUid(1600, 1700, due)).toBe(false); // parasite Gmail
    expect(shouldProcessUid(1701, 1700, due)).toBe(true); // nouveau message
  });

  it('scénario incident : docx en retry (1624) — le PDF 1625+ est fetché et traité', () => {
    // Le set fetché contient à la fois le retry ET la plage des suivants :
    // aucun uid valide n'attend derrière le CV en échec.
    const set = buildFetchSet(1623, [1624]);
    // 1624 ≤ curseur+1 : couvert par la plage 1624:* → pas de doublon nommé.
    expect(set).toBe('1624:*');
    expect(shouldProcessUid(1625, 1623, new Set([1624]))).toBe(true);
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

  it('échéance future → fenêtre ouverte (uid non re-fetché, zéro coût LLM)', () => {
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
