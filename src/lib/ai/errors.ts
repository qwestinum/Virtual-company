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
 * une sortie exploitable. L'extraction (C4) attrape cette erreur et marque le
 * critère `non_verifiable` + `llmFailure: true` plutôt que de laisser entrer une
 * sortie non validée dans le scoring.
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
