import { z } from '@frontmcp/lazy-zod';

// Checked as `z.object({})` checks, but passed through as is: a passthrough object copies every key of a Node request.
const httpObjectSchema = () =>
  z.custom<Record<string, unknown>>().check((ctx) => {
    const value = ctx.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      ctx.issues.push({ code: 'invalid_type', expected: 'object', input: value });
    }
  });

export const httpInputSchema = z.object({
  request: httpObjectSchema(), // TODO: must be validated
  response: httpObjectSchema(),
  next: z.function().optional(),
});

export const httpRequestInputSchema = z.object({
  request: httpObjectSchema(), // TODO: must be validated
});
