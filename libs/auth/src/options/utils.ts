// options/utils.ts
// Helper functions for auth options

import { authOptionsSchema, AuthOptions, AuthOptionsInput } from './schema';
import { PublicAuthOptions } from './public.schema';
import { TransparentAuthOptions } from './transparent.schema';
import { LocalAuthOptions, RemoteAuthOptions, LocalOrRemoteAuthOptions } from './orchestrated.schema';

// ============================================
// PARSING
// ============================================

/**
 * Parse and validate auth options with defaults
 */
export function parseAuthOptions(input: AuthOptionsInput): AuthOptions {
  return authOptionsSchema.parse(input);
}

// ============================================
// MODE TYPE GUARDS
// ============================================

/**
 * Check if options are public mode
 */
export function isPublicMode(options: AuthOptions | AuthOptionsInput): options is PublicAuthOptions {
  return options.mode === 'public';
}

/**
 * Check if options are transparent mode
 */
export function isTransparentMode(options: AuthOptions | AuthOptionsInput): options is TransparentAuthOptions {
  return options.mode === 'transparent';
}

/**
 * Check if options are local mode (formerly orchestrated local)
 */
export function isLocalMode(options: AuthOptions | AuthOptionsInput): options is LocalAuthOptions {
  return options.mode === 'local';
}

/**
 * Check if options are remote mode (formerly orchestrated remote)
 */
export function isRemoteMode(options: AuthOptions | AuthOptionsInput): options is RemoteAuthOptions {
  return options.mode === 'remote';
}

/**
 * Check if options are orchestrated mode (local or remote).
 * This replaces the old isOrchestratedMode check.
 */
export function isOrchestratedMode(options: AuthOptions | AuthOptionsInput): options is LocalOrRemoteAuthOptions {
  return options.mode === 'local' || options.mode === 'remote';
}

// ============================================
// LOCAL/REMOTE TYPE GUARDS
// ============================================

/**
 * Check if local-or-remote options are local type
 */
export function isOrchestratedLocal(options: LocalOrRemoteAuthOptions): options is LocalAuthOptions {
  return options.mode === 'local';
}

/**
 * Check if local-or-remote options are remote type
 */
export function isOrchestratedRemote(options: LocalOrRemoteAuthOptions): options is RemoteAuthOptions {
  return options.mode === 'remote';
}

// ============================================
// ACCESS HELPERS
// ============================================

/**
 * Check if options allow public/anonymous access
 */
export function allowsPublicAccess(options: AuthOptions): boolean {
  if (options.mode === 'public') return true;
  if (options.mode === 'transparent') return options.allowAnonymous;
  if (options.mode === 'local' || options.mode === 'remote') return options.allowDefaultPublic;
  return false;
}
