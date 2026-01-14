// common/types/options/auth/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas
//
// This file ensures that the explicit interfaces in interfaces.ts
// stay in sync with the Zod schemas in the *.schema.ts files.
//
// If an interface property is added/removed/changed but schema isn't updated
// (or vice versa), the build fails with a type error.
//
// This file is included in the build but exports nothing - purely for
// compile-time validation.

import type { z } from 'zod';

// Import schemas
import type { publicAccessConfigSchema, remoteProviderConfigSchema } from './shared.schemas';
import type { publicAuthOptionsSchema } from './public.schema';
import type { transparentAuthOptionsSchema } from './transparent.schema';
import type { orchestratedLocalSchema, orchestratedRemoteSchema } from './orchestrated.schema';

// Import interfaces
import type {
  PublicAccessConfig,
  RemoteProviderConfig,
  PublicAuthOptionsInterface,
  TransparentAuthOptionsInterface,
  OrchestratedLocalOptionsInterface,
  OrchestratedRemoteOptionsInterface,
} from './interfaces';

// ============================================
// TYPE SYNC HELPERS
// ============================================

/**
 * Check if two types are exactly equal
 * Returns true only if T and U are the same type
 */
type IsEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

/**
 * Enforce that T extends true - fails to compile otherwise
 */
type AssertTrue<T extends true> = T;

/**
 * Check if T is assignable to U (T can be used where U is expected)
 * This is a one-way compatibility check
 */
type IsAssignable<T, U> = T extends U ? true : false;

// ============================================
// SHARED CONFIG CHECKS
// ============================================

// Check PublicAccessConfig is assignable to schema output
type _PublicAccessFromSchema = z.output<typeof publicAccessConfigSchema>;
type _PublicAccessCheck = AssertTrue<IsAssignable<PublicAccessConfig, Partial<_PublicAccessFromSchema>>>;

// Check RemoteProviderConfig is assignable to schema output
type _RemoteFromSchema = z.output<typeof remoteProviderConfigSchema>;
type _RemoteCheck = AssertTrue<IsAssignable<RemoteProviderConfig, Partial<_RemoteFromSchema>>>;

// ============================================
// AUTH MODE CHECKS
// ============================================

// Check PublicAuthOptionsInterface - input type (what user provides)
type _PublicSchemaInput = z.input<typeof publicAuthOptionsSchema>;
type _PublicInterfaceCheck = AssertTrue<IsAssignable<PublicAuthOptionsInterface, _PublicSchemaInput>>;

// Check TransparentAuthOptionsInterface
type _TransparentSchemaInput = z.input<typeof transparentAuthOptionsSchema>;
type _TransparentInterfaceCheck = AssertTrue<IsAssignable<TransparentAuthOptionsInterface, _TransparentSchemaInput>>;

// Check OrchestratedLocalOptionsInterface
type _OrchestratedLocalSchemaInput = z.input<typeof orchestratedLocalSchema>;
type _OrchestratedLocalInterfaceCheck = AssertTrue<
  IsAssignable<OrchestratedLocalOptionsInterface, _OrchestratedLocalSchemaInput>
>;

// Check OrchestratedRemoteOptionsInterface
type _OrchestratedRemoteSchemaInput = z.input<typeof orchestratedRemoteSchema>;
type _OrchestratedRemoteInterfaceCheck = AssertTrue<
  IsAssignable<OrchestratedRemoteOptionsInterface, _OrchestratedRemoteSchemaInput>
>;

// ============================================
// MODE LITERAL CHECKS
// ============================================

// Ensure mode literals match
type _PublicModeCheck = AssertTrue<IsEqual<PublicAuthOptionsInterface['mode'], 'public'>>;
type _TransparentModeCheck = AssertTrue<IsEqual<TransparentAuthOptionsInterface['mode'], 'transparent'>>;
type _OrchestratedLocalModeCheck = AssertTrue<IsEqual<OrchestratedLocalOptionsInterface['mode'], 'orchestrated'>>;
type _OrchestratedRemoteModeCheck = AssertTrue<IsEqual<OrchestratedRemoteOptionsInterface['mode'], 'orchestrated'>>;

// Ensure type literals match for orchestrated
type _OrchestratedLocalTypeCheck = AssertTrue<IsEqual<OrchestratedLocalOptionsInterface['type'], 'local'>>;
type _OrchestratedRemoteTypeCheck = AssertTrue<IsEqual<OrchestratedRemoteOptionsInterface['type'], 'remote'>>;

// ============================================
// EXPORT
// ============================================

// Export nothing - this file is only for type checking
export {};
