export type AIProviderErrorCode =
  | 'config_missing'
  | 'api_error'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_response'
  | 'client_context';

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly cause?: unknown;

  constructor(code: AIProviderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Échec de validation d'une sortie LLM censée être un JSON conforme à un schéma
 * Zod, après épuisement des tentatives (`chatCompleteJson`). Distinct de
 * `AIProviderError` (erreur transport/API) : c'est le LLM qui n'a pas produit
 * une sortie exploitable. Selon la phase, l'appelant dégrade proprement
 * (extraction candidat, ledger, narration) ou ABANDONNE l'analyse
 * (`AnalysisUnavailableError` sur la phase verdicts — jamais de score fantôme).
 */
export class AIValidationError extends Error {
  readonly code = 'validation_failed' as const;
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = 'AIValidationError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Analyse de CV IMPOSSIBLE : la phase VERDICTS (la seule qui porte la décision)
 * n'a pas produit de sortie exploitable après retries. Correctif audit C2 —
 * l'ancien fallback fabriquait des verdicts `non_verifiable` ⇒ score ≈ 0 ⇒
 * refus AUTOMATIQUE envoyé au candidat pour une panne technique. Principe :
 * SOUS INCERTITUDE LLM, NE JAMAIS DÉCIDER NI ENVOYER. Cette erreur signifie
 * « aucune analyse, aucun score, aucune décision » — l'appelant re-tente
 * (poller IMAP : rails `minRetryUid`) ou remonte l'échec à l'utilisateur
 * (chat : 503 explicite).
 */
export class AnalysisUnavailableError extends Error {
  readonly code = 'analysis_unavailable' as const;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AnalysisUnavailableError';
    this.cause = cause;
  }
}
