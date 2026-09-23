import { AppError, isAppError } from '@prepforge/shared';
import { LlmTransportError } from './provider';

/** Converts provider failures into user-safe structured errors. */
export function toLlmAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof LlmTransportError) {
    switch (error.kind) {
      case 'rate_limited':
        return new AppError(
          'LLM_RATE_LIMITED',
          'The LLM provider is rate limiting requests. Please try again shortly.',
          { retryable: true, status: 503, cause: error },
        );
      case 'quota_exceeded':
        return new AppError(
          'LLM_RATE_LIMITED',
          'The LLM provider quota is exhausted. Check the API plan or billing.',
          { retryable: false, status: 503, cause: error },
        );
      case 'auth':
        return new AppError('LLM_NOT_CONFIGURED', 'The LLM API key was rejected by the provider.', {
          retryable: false,
          status: 503,
          cause: error,
        });
      case 'timeout':
      case 'unavailable':
        return new AppError('LLM_UNAVAILABLE', 'The LLM provider is temporarily unavailable.', {
          retryable: true,
          status: 503,
          cause: error,
        });
      case 'bad_request':
        return new AppError('LLM_UNAVAILABLE', 'The LLM provider rejected the request.', {
          retryable: false,
          status: 502,
          cause: error,
        });
    }
  }
  return new AppError('LLM_UNAVAILABLE', 'The LLM request failed unexpectedly.', {
    retryable: true,
    status: 502,
    cause: error,
  });
}
