// common/migrate/auth-transport.migrate.ts
//
// Migration helper for auth.transport -> transport config
//
// This file handles backward compatibility for the old config structure.
// DELETE THIS FILE when removing deprecated support (target: v1.0.0)
//
// Migration performed:
// 1. auth.transport -> transport (top-level)
// 2. session -> transport (merged)
// 3. auth.transport.recreation.redis -> redis (top-level, if not already set)
// 4. auth.tokenStorage.config -> references top-level redis

import type { TransportOptionsInput } from '../types/options/transport.options';
import type { RedisOptionsInput } from '../types/options/redis.options';
import type { SessionOptions } from '../types/options/session.options';

/**
 * Old transport config structure (nested under auth)
 */
interface OldTransportConfig {
  enableLegacySSE?: boolean;
  enableSseListener?: boolean;
  enableStreamableHttp?: boolean;
  enableStatelessHttp?: boolean;
  enableStatefulHttp?: boolean;
  requireSessionForStreamable?: boolean;
  recreation?: {
    enabled?: boolean;
    redis?: RedisOptionsInput;
    defaultTtlMs?: number;
  };
}

/**
 * Old auth config structure (with nested transport)
 */
interface OldAuthConfig {
  mode: string;
  transport?: OldTransportConfig;
  [key: string]: unknown;
}

/**
 * Metadata structure for migration
 */
interface MigratableMetadata {
  auth?: OldAuthConfig;
  session?: SessionOptions;
  transport?: TransportOptionsInput;
  redis?: RedisOptionsInput;
}

let deprecationWarningShown = false;

/**
 * Show deprecation warning once per process
 */
function showDeprecationWarning(hasOldTransport: boolean, hasOldSession: boolean): void {
  if (deprecationWarningShown) {
    return;
  }
  deprecationWarningShown = true;

  const warnings: string[] = [];
  if (hasOldTransport) {
    warnings.push('  - auth.transport is deprecated, use top-level "transport" instead');
  }
  if (hasOldSession) {
    warnings.push('  - session is deprecated, merge into top-level "transport" instead');
  }

  console.warn(
    '\n[DEPRECATION WARNING] FrontMCP config structure has changed:\n' +
      warnings.join('\n') +
      '\n  - For Redis config, use top-level "redis" instead\n' +
      '\nSee migration guide: https://docs.frontmcp.dev/migrate/transport-config\n',
  );
}

/**
 * Reset deprecation warning flag (for testing)
 */
export function resetDeprecationWarning(): void {
  deprecationWarningShown = false;
}

/**
 * Check if config needs migration
 */
export function needsMigration(metadata: MigratableMetadata): boolean {
  const hasOldTransport = !!(metadata.auth && 'transport' in metadata.auth && metadata.auth.transport);
  const hasOldSession = !!metadata.session;
  return hasOldTransport || hasOldSession;
}

/**
 * Migrate old config structure to new structure
 *
 * Returns the migrated values that should be applied to the metadata
 */
export function migrateAuthTransportConfig(metadata: MigratableMetadata): {
  transport?: TransportOptionsInput;
  redis?: RedisOptionsInput;
  auth?: OldAuthConfig;
} {
  const result: {
    transport?: TransportOptionsInput;
    redis?: RedisOptionsInput;
    auth?: OldAuthConfig;
  } = {};

  const hasOldTransport = !!(metadata.auth && 'transport' in metadata.auth && metadata.auth.transport);
  const hasOldSession = !!metadata.session;

  if (!hasOldTransport && !hasOldSession) {
    return result;
  }

  // Show deprecation warning
  showDeprecationWarning(hasOldTransport, hasOldSession);

  // Start with existing transport config if present
  result.transport = { ...metadata.transport };

  // Migrate session config
  if (hasOldSession) {
    const session = metadata.session!;
    result.transport = {
      ...result.transport,
      sessionMode: session.sessionMode,
      transportIdMode: session.transportIdMode,
      platformDetection: session.platformDetection,
    };
  }

  // Migrate auth.transport config
  if (hasOldTransport) {
    const oldTransport = metadata.auth!.transport!;

    // Merge transport protocol settings
    result.transport = {
      ...result.transport,
      enableLegacySSE: oldTransport.enableLegacySSE ?? result.transport.enableLegacySSE,
      enableSseListener: oldTransport.enableSseListener ?? result.transport.enableSseListener,
      enableStreamableHttp: oldTransport.enableStreamableHttp ?? result.transport.enableStreamableHttp,
      enableStatelessHttp: oldTransport.enableStatelessHttp ?? result.transport.enableStatelessHttp,
      enableStatefulHttp: oldTransport.enableStatefulHttp ?? result.transport.enableStatefulHttp,
      requireSessionForStreamable:
        oldTransport.requireSessionForStreamable ?? result.transport.requireSessionForStreamable,
    };

    // Migrate recreation -> persistence
    if (oldTransport.recreation) {
      result.transport.persistence = {
        enabled: oldTransport.recreation.enabled ?? false,
        redis: oldTransport.recreation.redis,
        defaultTtlMs: oldTransport.recreation.defaultTtlMs,
      };

      // Extract Redis config to top-level if not already present
      if (oldTransport.recreation.redis && !metadata.redis) {
        result.redis = oldTransport.recreation.redis;
      }
    }

    // Create clean auth without transport
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { transport: _, ...cleanAuth } = metadata.auth!;
    result.auth = cleanAuth as OldAuthConfig;
  }

  return result;
}

/**
 * Apply migration to metadata (mutates in place for decorator use)
 *
 * This function takes a metadata object with the old config structure
 * and transforms it to the new structure in place.
 */
export function applyMigration<T extends MigratableMetadata>(metadata: T): T {
  if (!needsMigration(metadata)) {
    return metadata;
  }

  const migrated = migrateAuthTransportConfig(metadata);

  // Apply migrated transport config
  if (migrated.transport) {
    (metadata as Record<string, unknown>)['transport'] = {
      ...metadata.transport,
      ...migrated.transport,
    };
  }

  // Apply migrated redis config
  if (migrated.redis) {
    (metadata as Record<string, unknown>)['redis'] = migrated.redis;
  }

  // Apply cleaned auth config (without transport)
  if (migrated.auth) {
    metadata.auth = migrated.auth;
  }

  return metadata;
}
