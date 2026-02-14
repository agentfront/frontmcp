// options/utils.ts
// Helper functions for auth options

import { authOptionsSchema, AuthOptions, AuthOptionsInput } from './schema';
import { PublicAuthOptions } from './public.schema';
import { TransparentAuthOptions } from './transparent.schema';
import { OrchestratedAuthOptions, OrchestratedLocalOptions, OrchestratedRemoteOptions } from './orchestrated.schema';

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
 * Check if options are orchestrated mode
 */
export function isOrchestratedMode(options: AuthOptions | AuthOptionsInput): options is OrchestratedAuthOptions {
  return options.mode === 'orchestrated';
}

// ============================================
// ORCHESTRATED TYPE GUARDS
// ============================================

/**
 * Check if orchestrated options are local type
 */
export function isOrchestratedLocal(options: OrchestratedAuthOptions): options is OrchestratedLocalOptions {
  return options.type === 'local';
}

/**
 * Check if orchestrated options are remote type
 */
export function isOrchestratedRemote(options: OrchestratedAuthOptions): options is OrchestratedRemoteOptions {
  return options.type === 'remote';
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
  if (options.mode === 'orchestrated') return options.allowDefaultPublic;
  return false;
}
