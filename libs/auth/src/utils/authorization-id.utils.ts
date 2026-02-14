// utils/authorization-id.utils.ts

import { sha256Hex } from '@frontmcp/utils';

/**
 * Derive a consistent authorization ID from a JWT token.
 *
 * Uses the token's signature (third part) to generate a deterministic
 * ID that uniquely identifies this authorization without exposing
 * the full token.
 *
 * @param token - JWT token string
 * @returns 16-character hex string authorization ID
 */
export function deriveAuthorizationId(token: string): string {
  const parts = token.split('.');
  const signature = parts[2] || token;
  return sha256Hex(signature).substring(0, 16);
}
