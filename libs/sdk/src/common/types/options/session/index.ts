// common/types/options/session/index.ts
// Barrel export for session options

export type {
  SessionMode,
  PlatformMappingEntryInterface,
  PlatformDetectionConfigInterface,
  SessionOptionsInterface,
} from './interfaces';

export { platformMappingEntrySchema, platformDetectionConfigSchema, sessionOptionsSchema } from './schema';

export type { PlatformMappingEntry, PlatformDetectionConfig, SessionOptions, SessionOptionsInput } from './schema';
