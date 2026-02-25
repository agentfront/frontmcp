// options/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas

import type { z } from 'zod';

// Import schemas
import type { publicAccessConfigSchema } from './shared.schemas';
import type { publicAuthOptionsSchema } from './public.schema';
import type { transparentAuthOptionsSchema } from './transparent.schema';
import type { localAuthSchema, remoteAuthSchema } from './orchestrated.schema';

// Import interfaces
import type {
  PublicAccessConfig,
  PublicAuthOptionsInterface,
  TransparentAuthOptionsInterface,
  LocalAuthOptionsInterface,
  RemoteAuthOptionsInterface,
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

// ============================================
// AUTH MODE CHECKS
// ============================================

type _PublicSchemaInput = z.input<typeof publicAuthOptionsSchema>;
type _PublicInterfaceCheck = AssertTrue<IsAssignable<PublicAuthOptionsInterface, _PublicSchemaInput>>;

type _TransparentSchemaInput = z.input<typeof transparentAuthOptionsSchema>;
type _TransparentInterfaceCheck = AssertTrue<IsAssignable<TransparentAuthOptionsInterface, _TransparentSchemaInput>>;

type _LocalSchemaInput = z.input<typeof localAuthSchema>;
type _LocalInterfaceCheck = AssertTrue<IsAssignable<LocalAuthOptionsInterface, _LocalSchemaInput>>;

type _RemoteSchemaInput = z.input<typeof remoteAuthSchema>;
type _RemoteInterfaceCheck = AssertTrue<IsAssignable<RemoteAuthOptionsInterface, _RemoteSchemaInput>>;

// ============================================
// MODE LITERAL CHECKS
// ============================================

type _PublicModeCheck = AssertTrue<IsEqual<PublicAuthOptionsInterface['mode'], 'public'>>;
type _TransparentModeCheck = AssertTrue<IsEqual<TransparentAuthOptionsInterface['mode'], 'transparent'>>;
type _LocalModeCheck = AssertTrue<IsEqual<LocalAuthOptionsInterface['mode'], 'local'>>;
type _RemoteModeCheck = AssertTrue<IsEqual<RemoteAuthOptionsInterface['mode'], 'remote'>>;

// ============================================
// EXPORT
// ============================================

export {};
