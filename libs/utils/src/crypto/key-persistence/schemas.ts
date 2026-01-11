/**
 * Zod schemas for key persistence validation.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { z } from 'zod';
import type { AnyKeyData, SecretKeyData, AsymmetricKeyData } from './types';

/**
 * Maximum allowed clock drift for createdAt validation (1 minute).
 */
const MAX_CLOCK_DRIFT_MS = 60000;

/**
 * Maximum age for a key (100 years in ms).
 */
const MAX_KEY_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Supported asymmetric algorithms.
 */
export const asymmetricAlgSchema = z.enum(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);

/**
 * Base key data schema.
 */
const baseKeyDataSchema = z.object({
  kid: z.string().min(1),
  createdAt: z.number().positive().int(),
  version: z.number().positive().int(),
});

/**
 * JsonWebKey schema (partial validation).
 */
const jsonWebKeySchema = z
  .object({
    kty: z.string().optional(),
    use: z.string().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
    d: z.string().optional(),
    p: z.string().optional(),
    q: z.string().optional(),
    dp: z.string().optional(),
    dq: z.string().optional(),
    qi: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    crv: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for SecretKeyData.
 */
export const secretKeyDataSchema = baseKeyDataSchema.extend({
  type: z.literal('secret'),
  secret: z.string().min(1),
  bytes: z.number().positive().int(),
});

/**
 * Zod schema for AsymmetricKeyData.
 */
export const asymmetricKeyDataSchema = baseKeyDataSchema.extend({
  type: z.literal('asymmetric'),
  alg: asymmetricAlgSchema,
  privateKey: jsonWebKeySchema,
  publicJwk: z.object({
    keys: z.array(jsonWebKeySchema).min(1),
  }),
});

/**
 * Zod schema for AnyKeyData (discriminated union).
 */
export const anyKeyDataSchema = z.discriminatedUnion('type', [secretKeyDataSchema, asymmetricKeyDataSchema]);

/**
 * Result of validating key data.
 */
export interface KeyValidationResult {
  /** Whether the key data is valid */
  valid: boolean;
  /** Parsed key data if valid */
  data?: AnyKeyData;
  /** Error message if invalid */
  error?: string;
}

/**
 * Validate key data structure and timestamps.
 *
 * Checks:
 * - Schema validation
 * - createdAt is not in the future (with 1 minute drift allowance)
 * - createdAt is not too old (100 years)
 *
 * @param data - Data to validate
 * @returns Validation result
 */
export function validateKeyData(data: unknown): KeyValidationResult {
  const result = anyKeyDataSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues[0]?.message ?? 'Invalid key structure',
    };
  }

  const parsed = result.data;
  const now = Date.now();

  // Verify createdAt is not in the future (with drift allowance)
  if (parsed.createdAt > now + MAX_CLOCK_DRIFT_MS) {
    return { valid: false, error: 'createdAt is in the future' };
  }

  // Verify not too old
  if (parsed.createdAt < now - MAX_KEY_AGE_MS) {
    return { valid: false, error: 'createdAt is too old' };
  }

  return { valid: true, data: parsed };
}

/**
 * Parse and validate key data.
 *
 * @param data - Raw data to parse
 * @returns Parsed key data or null if invalid
 */
export function parseKeyData(data: unknown): AnyKeyData | null {
  const validation = validateKeyData(data);
  if (!validation.valid) {
    return null;
  }
  return validation.data!;
}

/**
 * Check if key data is a secret key.
 */
export function isSecretKeyData(data: AnyKeyData): data is SecretKeyData {
  return data.type === 'secret';
}

/**
 * Check if key data is an asymmetric key.
 */
export function isAsymmetricKeyData(data: AnyKeyData): data is AsymmetricKeyData {
  return data.type === 'asymmetric';
}
