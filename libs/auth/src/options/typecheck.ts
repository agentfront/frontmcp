// options/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

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

type IsEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
type AssertTrue<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;

// ============================================
// SHARED CONFIG CHECKS
// ============================================

type _PublicAccessFromSchema = z.output<typeof publicAccessConfigSchema>;
type _PublicAccessCheck = AssertTrue<IsAssignable<PublicAccessConfig, Partial<_PublicAccessFromSchema>>>;

type _RemoteFromSchema = z.output<typeof remoteProviderConfigSchema>;
type _RemoteCheck = AssertTrue<IsAssignable<RemoteProviderConfig, Partial<_RemoteFromSchema>>>;

// ============================================
// AUTH MODE CHECKS
// ============================================

type _PublicSchemaInput = z.input<typeof publicAuthOptionsSchema>;
type _PublicInterfaceCheck = AssertTrue<IsAssignable<PublicAuthOptionsInterface, _PublicSchemaInput>>;

type _TransparentSchemaInput = z.input<typeof transparentAuthOptionsSchema>;
type _TransparentInterfaceCheck = AssertTrue<IsAssignable<TransparentAuthOptionsInterface, _TransparentSchemaInput>>;

type _OrchestratedLocalSchemaInput = z.input<typeof orchestratedLocalSchema>;
type _OrchestratedLocalInterfaceCheck = AssertTrue<
  IsAssignable<OrchestratedLocalOptionsInterface, _OrchestratedLocalSchemaInput>
>;

type _OrchestratedRemoteSchemaInput = z.input<typeof orchestratedRemoteSchema>;
type _OrchestratedRemoteInterfaceCheck = AssertTrue<
  IsAssignable<OrchestratedRemoteOptionsInterface, _OrchestratedRemoteSchemaInput>
>;

// ============================================
// MODE LITERAL CHECKS
// ============================================

type _PublicModeCheck = AssertTrue<IsEqual<PublicAuthOptionsInterface['mode'], 'public'>>;
type _TransparentModeCheck = AssertTrue<IsEqual<TransparentAuthOptionsInterface['mode'], 'transparent'>>;
type _OrchestratedLocalModeCheck = AssertTrue<IsEqual<OrchestratedLocalOptionsInterface['mode'], 'orchestrated'>>;
type _OrchestratedRemoteModeCheck = AssertTrue<IsEqual<OrchestratedRemoteOptionsInterface['mode'], 'orchestrated'>>;

type _OrchestratedLocalTypeCheck = AssertTrue<IsEqual<OrchestratedLocalOptionsInterface['type'], 'local'>>;
type _OrchestratedRemoteTypeCheck = AssertTrue<IsEqual<OrchestratedRemoteOptionsInterface['type'], 'remote'>>;

// ============================================
// EXPORT
// ============================================

export {};
