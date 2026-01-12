/**
 * CredentialCache DI Token
 *
 * SDK-specific DI token for CredentialCache.
 * The CredentialCache class itself is exported from @frontmcp/auth.
 */

import { Token } from '@frontmcp/di';
import type { CredentialCache } from '@frontmcp/auth';

/**
 * DI Token for CredentialCache
 */
export const CREDENTIAL_CACHE = Symbol.for('frontmcp:CREDENTIAL_CACHE') as Token<CredentialCache>;
