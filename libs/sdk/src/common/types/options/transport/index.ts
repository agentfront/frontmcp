// common/types/options/transport/index.ts
// Barrel export for transport options

// ============================================
// EXPLICIT INTERFACES (for better autocomplete)
// ============================================
export type {
  // Main transport interface
  TransportOptionsInterface,
  TransportOptionsInput,
  // Protocol types
  ProtocolConfig,
  ProtocolPreset,
  // Persistence types
  PersistenceConfig,
  // Session types (re-exported from session options)
  SessionMode,
  SessionModeOption,
  PlatformMappingEntry,
  PlatformDetectionConfig,
  // Distributed mode types
  DistributedEnabled,
} from './interfaces';

// ============================================
// SCHEMAS & SCHEMA TYPES
// ============================================
export {
  // Main schema
  transportOptionsSchema,
  // Sub-schemas
  persistenceConfigSchema,
  // Protocol presets
  PROTOCOL_PRESETS,
  // Helper functions
  expandProtocolConfig,
  toLegacyProtocolFlags,
  isDistributedMode,
  shouldCacheProviders,
  expandTransportConfig,
} from './schema';

export type {
  // Zod-inferred types
  TransportOptions,
  TransportPersistenceConfig,
  TransportPersistenceConfigInput,
  PlatformDetectionConfigType,
  DistributedConfigInput,
  // Internal types
  LegacyProtocolFlags,
  ExpandedTransportConfig,
} from './schema';
