// common/types/options/outbound-fetch/schema.ts
// Zod schema for outbound `this.fetch()` configuration

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type { OutboundFetchOptionsInterface } from './interfaces';

const httpOriginSchema = z
  .string()
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), { message: 'Origin must be an http(s) URL' })
  .transform((value) => new URL(value).origin);

/**
 * Zod schema for OutboundFetchOptions.
 */
export const outboundFetchOptionsSchema = z.object({
  forwardCallerTokenTo: z.array(httpOriginSchema).optional().default([]),
  forwardCustomHeadersTo: z.array(httpOriginSchema).optional().default([]),
  autoInjectTracingHeaders: z.boolean().optional().default(true),
  requestTimeout: z.number().int().positive().optional().default(30000),
} satisfies RawZodShape<OutboundFetchOptionsInterface>);

/**
 * Outbound fetch options type (with defaults applied).
 */
export type OutboundFetchOptions = z.infer<typeof outboundFetchOptionsSchema>;

/**
 * Outbound fetch options input type (for user configuration).
 */
export type OutboundFetchOptionsInput = z.input<typeof outboundFetchOptionsSchema>;
