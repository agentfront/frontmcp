/**
 * Validation schema for secret data.
 *
 * @module @frontmcp/utils/secret-persistence
 */

import { z } from 'zod';
import type { SecretData, SecretValidationResult } from './types';

/**
 * Zod schema for SecretData.
 */
export const secretDataSchema = z
  .object({
    secret: z.string().base64url().length(43), // base64url of 32 bytes is exactly 43 chars
    createdAt: z.number().positive().int(),
    version: z.number().positive().int(),
  })
  .strict();

/**
 * Maximum allowed clock drift for createdAt validation (1 minute).
 */
const MAX_CLOCK_DRIFT_MS = 60000;

/**
 * Maximum age for a secret (100 years in ms).
 */
const MAX_SECRET_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Validate secret data structure.
 *
 * Checks:
 * - Schema validation
 * - createdAt is not in the future (with 1 minute drift allowance)
 * - createdAt is not too old (100 years)
 *
 * @param data - Data to validate
 * @returns Validation result
 */
export function validateSecretData(data: unknown): SecretValidationResult {
  const result = secretDataSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues[0]?.message ?? 'Invalid secret structure',
    };
  }

  const parsed = result.data;
  const now = Date.now();

  // Verify createdAt is not in the future (with drift allowance)
  if (parsed.createdAt > now + MAX_CLOCK_DRIFT_MS) {
    return { valid: false, error: 'createdAt is in the future' };
  }

  // Verify not too old
  if (parsed.createdAt < now - MAX_SECRET_AGE_MS) {
    return { valid: false, error: 'createdAt is too old' };
  }

  return { valid: true };
}

/**
 * Parse and validate secret data.
 *
 * @param data - Raw data to parse
 * @returns Parsed secret data or null if invalid
 */
export function parseSecretData(data: unknown): SecretData | null {
  const validation = validateSecretData(data);
  if (!validation.valid) {
    return null;
  }
  return data as SecretData;
}
