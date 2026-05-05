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
