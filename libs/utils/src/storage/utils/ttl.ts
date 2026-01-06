/**
 * TTL Validation Utilities
 *
 * Helper functions for validating and normalizing TTL values.
 */

import { StorageTTLError } from '../errors';

/**
 * Maximum TTL in seconds (roughly 100 years).
 * Prevents integer overflow issues.
 */
export const MAX_TTL_SECONDS = 3153600000;

/**
 * Validate a TTL value.
 *
 * @param ttlSeconds - TTL in seconds
 * @throws StorageTTLError if TTL is invalid
 */
export function validateTTL(ttlSeconds: number): void {
  if (typeof ttlSeconds !== 'number') {
    throw new StorageTTLError(ttlSeconds, `TTL must be a number, got ${typeof ttlSeconds}`);
  }

  if (!Number.isFinite(ttlSeconds)) {
    throw new StorageTTLError(ttlSeconds, 'TTL must be a finite number');
  }

  if (!Number.isInteger(ttlSeconds)) {
    throw new StorageTTLError(ttlSeconds, `TTL must be an integer, got ${ttlSeconds}`);
  }

  if (ttlSeconds <= 0) {
    throw new StorageTTLError(ttlSeconds, `TTL must be positive, got ${ttlSeconds}`);
  }

  if (ttlSeconds > MAX_TTL_SECONDS) {
    throw new StorageTTLError(ttlSeconds, `TTL exceeds maximum of ${MAX_TTL_SECONDS} seconds`);
  }
}

/**
 * Validate TTL if provided (optional TTL).
 *
 * @param ttlSeconds - Optional TTL in seconds
 * @throws StorageTTLError if TTL is provided but invalid
 */
export function validateOptionalTTL(ttlSeconds: number | undefined): void {
  if (ttlSeconds !== undefined) {
    validateTTL(ttlSeconds);
  }
}

/**
 * Calculate expiration timestamp from TTL.
 *
 * @param ttlSeconds - TTL in seconds
 * @returns Expiration timestamp (Date.now() + ttlSeconds * 1000)
 */
export function ttlToExpiresAt(ttlSeconds: number): number {
  return Date.now() + ttlSeconds * 1000;
}

/**
 * Calculate remaining TTL from expiration timestamp.
 *
 * @param expiresAt - Expiration timestamp
 * @returns Remaining seconds, or 0 if expired
 */
export function expiresAtToTTL(expiresAt: number): number {
  const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Check if an expiration timestamp has passed.
 *
 * @param expiresAt - Expiration timestamp
 * @returns true if expired (current time >= expiresAt)
 */
export function isExpired(expiresAt: number | undefined): boolean {
  if (expiresAt === undefined) return false;
  return Date.now() >= expiresAt;
}

/**
 * Normalize TTL to seconds if provided in milliseconds.
 * Useful for adapting from APIs that use milliseconds.
 *
 * @param ttl - TTL value
 * @param unit - 'seconds' or 'milliseconds'
 * @returns TTL in seconds
 */
export function normalizeTTL(ttl: number, unit: 'seconds' | 'milliseconds'): number {
  return unit === 'milliseconds' ? Math.ceil(ttl / 1000) : ttl;
}
