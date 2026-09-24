import type { Request } from 'express';
import type { z } from 'zod';

/** Parses and returns the request body; ZodErrors are turned into 400 responses by the error handler. */
export function parseBody<T>(schema: z.ZodType<T>, req: Request): T {
  return schema.parse(req.body ?? {});
}

export function parseQuery<T>(schema: z.ZodType<T>, req: Request): T {
  return schema.parse(req.query ?? {});
}
