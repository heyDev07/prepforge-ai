import { AppError, isAppError, type ErrorResponse } from '@prepforge/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** Details we are willing to show clients, per error code. */
const PUBLIC_DETAIL_KEYS = new Set(['existing_kit_id', 'job', 'fields']);

function publicDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  const entries = Object.entries(details).filter(([key]) => PUBLIC_DETAIL_KEYS.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function toResponse(error: AppError): ErrorResponse {
  const details = publicDetails(error.details);
  return { error: { ...error.toJSON(), ...(details ? { details } : {}) } };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Route not found.', { status: 404 }));
};

/**
 * Converts every error into the structured shape. Internal messages and stack traces never
 * reach clients; unknown errors become a generic INTERNAL_ERROR and are logged server-side.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  let appError: AppError;
  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.join('.');
    appError = new AppError(
      'INVALID_INPUT',
      field ? `${field}: ${first!.message}` : (first?.message ?? 'Invalid request.'),
      {
        status: 400,
        details: {
          fields: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    );
  } else if ((error as { type?: string }).type === 'entity.parse.failed') {
    appError = new AppError('INVALID_INPUT', 'The request body is not valid JSON.', {
      status: 400,
    });
  } else if ((error as { type?: string }).type === 'entity.too.large') {
    appError = new AppError('INVALID_INPUT', 'The request body is too large.', { status: 413 });
  } else {
    console.error('[api] unexpected error', error);
    appError = new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', {
      status: 500,
      retryable: true,
    });
  }
  res
    .status(appError.status >= 400 && appError.status < 600 ? appError.status : 500)
    .json(toResponse(appError));
};
