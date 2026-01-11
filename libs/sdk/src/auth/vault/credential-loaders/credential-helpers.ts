/**
 * Credential Helpers
 *
 * Shared utilities for credential loaders.
 */

import type { Credential } from '../../session/authorization-vault';

/**
 * Extract expiry time from a credential.
 *
 * @param credential - The credential to extract expiry from
 * @returns Expiry timestamp in epoch ms, or undefined if no expiry
 */
export function extractCredentialExpiry(credential: Credential): number | undefined {
  switch (credential.type) {
    case 'oauth':
    case 'oauth_pkce':
    case 'bearer':
    case 'service_account':
      return credential.expiresAt;
    default:
      return undefined;
  }
}
