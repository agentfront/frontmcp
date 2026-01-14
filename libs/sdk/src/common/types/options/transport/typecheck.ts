// common/types/options/transport/typecheck.ts
// Compile-time type sync checks between interfaces and Zod schemas
//
// This file ensures that the explicit interfaces in interfaces.ts
// stay in sync with the Zod schemas in schema.ts.
//
// If an interface property is added/removed/changed but schema isn't updated
// (or vice versa), the build fails with a type error.
//
// This file is included in the build but exports nothing - purely for
// compile-time validation.

import type { z } from 'zod';

// Import schemas
import type { transportOptionsSchema, persistenceConfigSchema } from './schema';
// Platform detection schemas are in session folder
import type { platformDetectionConfigSchema, platformMappingEntrySchema } from '../session';

// Import interfaces
import type {
  TransportOptionsInterface,
  PersistenceConfig,
  PlatformDetectionConfig,
  PlatformMappingEntry,
  ProtocolConfig,
  ProtocolPreset,
} from './interfaces';

// ============================================
// TYPE SYNC HELPERS
// ============================================

/**
 * Check if T is assignable to U (T can be used where U is expected)
 * This is a one-way compatibility check
 */
type IsAssignable<T, U> = T extends U ? true : false;

/**
 * Enforce that T extends true - fails to compile otherwise
 */
type AssertTrue<T extends true> = T;

/**
 * Check if two types are exactly equal
 */
type IsEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// ============================================
// PLATFORM DETECTION CHECKS
// ============================================

type _PlatformMappingSchemaInput = z.input<typeof platformMappingEntrySchema>;
type _PlatformMappingCheck = AssertTrue<IsAssignable<PlatformMappingEntry, _PlatformMappingSchemaInput>>;

type _PlatformDetectionSchemaInput = z.input<typeof platformDetectionConfigSchema>;
type _PlatformDetectionCheck = AssertTrue<IsAssignable<PlatformDetectionConfig, _PlatformDetectionSchemaInput>>;

// ============================================
// PERSISTENCE CONFIG CHECKS
// ============================================

type _PersistenceSchemaInput = z.input<typeof persistenceConfigSchema>;
type _PersistenceCheck = AssertTrue<IsAssignable<PersistenceConfig, _PersistenceSchemaInput>>;

// ============================================
// PROTOCOL CONFIG CHECKS
// ============================================

// Protocol config should be compatible with the schema's protocol config object
type _ProtocolConfigKeys = keyof ProtocolConfig;
type _ExpectedProtocolKeys = 'sse' | 'streamable' | 'json' | 'stateless' | 'legacy' | 'strictSession';
type _ProtocolKeysMatch = AssertTrue<IsEqual<_ProtocolConfigKeys, _ExpectedProtocolKeys>>;

// Protocol preset should match schema's preset enum
type _PresetValues = ProtocolPreset;
type _ExpectedPresets = 'modern' | 'legacy' | 'stateless-api' | 'full';
type _PresetMatch = AssertTrue<IsEqual<_PresetValues, _ExpectedPresets>>;

// ============================================
// MAIN TRANSPORT OPTIONS CHECKS
// ============================================

type _TransportSchemaInput = z.input<typeof transportOptionsSchema>;
type _TransportInterfaceCheck = AssertTrue<IsAssignable<TransportOptionsInterface, _TransportSchemaInput>>;

// ============================================
// VERIFY ALL REQUIRED KEYS ARE PRESENT
// ============================================

// Get keys from schema input (what zod expects)
type _SchemaKeys = keyof _TransportSchemaInput;

// Get keys from interface (what we define)
type _InterfaceKeys = keyof TransportOptionsInterface;

// All schema keys should be present in interface
type _AllSchemaKeysInInterface = AssertTrue<IsAssignable<_SchemaKeys, _InterfaceKeys>>;

// All interface keys should be present in schema (no extra keys)
type _AllInterfaceKeysInSchema = AssertTrue<IsAssignable<_InterfaceKeys, _SchemaKeys>>;

// ============================================
// DISTRIBUTED MODE CHECKS
// ============================================

// Verify distributedMode union type matches
type _DistributedModeType = TransportOptionsInterface['distributedMode'];
type _ExpectedDistributedMode = boolean | 'auto' | undefined;
type _DistributedModeMatch = AssertTrue<IsAssignable<_DistributedModeType, _ExpectedDistributedMode>>;

// ============================================
// SESSION MODE CHECKS
// ============================================

// Verify sessionMode can be literal or function
type _SessionModeType = TransportOptionsInterface['sessionMode'];
type _SessionModeCheck = _SessionModeType extends
  | 'stateful'
  | 'stateless'
  | ((issuer: string) => Promise<'stateful' | 'stateless'> | 'stateful' | 'stateless')
  | undefined
  ? true
  : false;
type _SessionModeValid = AssertTrue<_SessionModeCheck>;

// ============================================
// PERSISTENCE TYPE CHECKS
// ============================================

// Verify persistence can be false, object, or undefined
type _PersistenceType = TransportOptionsInterface['persistence'];
type _PersistenceTypeCheck = _PersistenceType extends false | PersistenceConfig | undefined ? true : false;
type _PersistenceTypeValid = AssertTrue<_PersistenceTypeCheck>;

// ============================================
// EXPORT
// ============================================

// Export nothing - this file is only for type checking
export {};
