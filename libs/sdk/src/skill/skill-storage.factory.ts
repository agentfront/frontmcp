// file: libs/sdk/src/skill/skill-storage.factory.ts

/**
 * Skill Storage Factory
 *
 * Factory functions for creating skill storage providers.
 * Supports Memory (default), VectorDB, and External backends.
 *
 * @module skill/skill-storage.factory
 */

import type { FrontMcpLogger } from '../common';
import type { ToolRegistryInterface } from '../common/interfaces/internal';
import type { SkillStorageProvider, SkillStorageProviderType } from './skill-storage.interface';
import { SkillToolValidator } from './skill-validator';
import { MemorySkillProvider, MemorySkillProviderOptions } from './providers/memory-skill.provider';
import type { ExternalSkillProviderBase, ExternalSkillMode } from './providers/external-skill.provider';
import type { SkillSyncStateStore } from './sync/sync-state.interface';
import { PublicMcpError, MCP_ERROR_CODES } from '../errors';

/**
 * VectorDB provider options (for external vector database).
 */
export interface VectorDBSkillProviderOptions {
  /**
   * Embedding strategy to use.
   * @default 'tfidf'
   */
  strategy?: 'tfidf' | 'ml';

  /**
   * Model name for ML embeddings.
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  modelName?: string;

  /**
   * Default number of search results.
   * @default 10
   */
  defaultTopK?: number;

  /**
   * Default minimum similarity threshold.
   * @default 0.1
   */
  defaultMinScore?: number;
}

/**
 * External provider configuration.
 * Used when connecting to external skill storage (e.g., shared vector DB).
 */
export interface ExternalSkillProviderConfig {
  /**
   * Operating mode for the external provider.
   *
   * - 'read-only': Skills are fetched from external storage, no writes
   * - 'persistent': Local skills are synced to external storage with SHA-based change detection
   */
  mode: ExternalSkillMode;

  /**
   * Store for persisting sync state.
   * Required for persistent mode to track which skills have been synced.
   */
  syncStateStore?: SkillSyncStateStore;

  /**
   * Default number of search results.
   * @default 10
   */
  defaultTopK?: number;

  /**
   * Default minimum similarity threshold.
   * @default 0.1
   */
  defaultMinScore?: number;
}

/**
 * Extended factory result that includes external provider when applicable.
 */
export interface ExtendedSkillStorageFactoryResult extends SkillStorageFactoryResult {
  /**
   * The external provider instance if type is 'external'.
   * Provides access to sync methods and state.
   */
  externalProvider?: ExternalSkillProviderBase;
}

/**
 * Options for creating a skill storage provider.
 */
export interface SkillStorageFactoryOptions {
  /**
   * Provider type to use.
   * @default 'memory'
   */
  provider?: 'memory' | 'vectordb' | 'external';

  /**
   * Options for memory provider.
   */
  memory?: Omit<MemorySkillProviderOptions, 'toolValidator'>;

  /**
   * Options for VectorDB provider.
   */
  vectordb?: VectorDBSkillProviderOptions;

  /**
   * Configuration for external provider.
   * Note: External providers require a concrete implementation to be passed.
   */
  external?: ExternalSkillProviderConfig;

  /**
   * Custom external provider instance.
   * Required when provider is 'external'.
   * Must extend ExternalSkillProviderBase.
   */
  externalProvider?: ExternalSkillProviderBase;

  /**
   * Tool registry for validating tool references.
   * Required for tool validation in search results.
   */
  toolRegistry?: ToolRegistryInterface;

  /**
   * Logger instance.
   */
  logger?: FrontMcpLogger;
}

/**
 * Result of creating a skill storage provider.
 */
export interface SkillStorageFactoryResult {
  /**
   * The created storage provider.
   */
  provider: SkillStorageProvider;

  /**
   * The type of provider created.
   */
  type: SkillStorageProviderType;

  /**
   * Tool validator (if tool registry was provided).
   */
  toolValidator?: SkillToolValidator;
}

/**
 * Create a skill storage provider based on configuration.
 *
 * @param options - Configuration options
 * @returns The created provider with type information
 *
 * @example Memory provider (default)
 * ```typescript
 * const { provider, type } = createSkillStorageProvider({
 *   toolRegistry: scope.tools,
 *   logger,
 * });
 * ```
 *
 * @example VectorDB provider
 * ```typescript
 * const { provider, type } = createSkillStorageProvider({
 *   provider: 'vectordb',
 *   vectordb: { strategy: 'ml' },
 *   toolRegistry: scope.tools,
 *   logger,
 * });
 * ```
 *
 * @example External provider (read-only)
 * ```typescript
 * const { provider, type, externalProvider } = createSkillStorageProvider({
 *   provider: 'external',
 *   externalProvider: new MyExternalProvider({ mode: 'read-only' }),
 *   logger,
 * });
 * ```
 *
 * @example External provider (persistent)
 * ```typescript
 * const { provider, externalProvider } = createSkillStorageProvider({
 *   provider: 'external',
 *   externalProvider: new MyExternalProvider({
 *     mode: 'persistent',
 *     syncStateStore: new MemorySyncStateStore(),
 *   }),
 *   logger,
 * });
 * // Later: sync local skills
 * await externalProvider.syncSkills(localSkills);
 * ```
 */
export function createSkillStorageProvider(
  options: SkillStorageFactoryOptions = {},
): ExtendedSkillStorageFactoryResult {
  const { provider: providerType = 'memory', memory, externalProvider, toolRegistry, logger } = options;

  // Create tool validator if registry is available
  let toolValidator: SkillToolValidator | undefined;
  if (toolRegistry) {
    toolValidator = new SkillToolValidator(toolRegistry);
  }

  let provider: SkillStorageProvider;
  let type: SkillStorageProviderType;
  let extProvider: ExternalSkillProviderBase | undefined;

  switch (providerType) {
    case 'external': {
      if (!externalProvider) {
        logger?.error('[SkillStorageFactory] External provider type requires externalProvider instance to be passed');
        throw new PublicMcpError(
          'External provider type requires externalProvider instance. ' +
            'Create a class extending ExternalSkillProviderBase and pass it via externalProvider option.',
          String(MCP_ERROR_CODES.INVALID_PARAMS),
          500,
        );
      }

      provider = externalProvider;
      extProvider = externalProvider;
      type = 'external';

      logger?.debug('[SkillStorageFactory] Using external skill provider', {
        mode: externalProvider.isReadOnly() ? 'read-only' : 'persistent',
      });
      break;
    }

    case 'vectordb': {
      // Lazy require VectorDB provider to avoid bundling when not used
      try {
        // VectorDB provider will be implemented in Phase 7
        // For now, fall back to memory provider with a warning
        logger?.warn('[SkillStorageFactory] VectorDB provider not yet implemented, falling back to memory provider');
        provider = new MemorySkillProvider({
          ...memory,
          toolValidator,
        });
        type = 'memory';
      } catch (error) {
        logger?.warn('[SkillStorageFactory] Failed to create VectorDB provider, falling back to memory', {
          error: error instanceof Error ? error.message : String(error),
        });
        provider = new MemorySkillProvider({
          ...memory,
          toolValidator,
        });
        type = 'memory';
      }
      break;
    }

    case 'memory':
    default: {
      provider = new MemorySkillProvider({
        ...memory,
        toolValidator,
      });
      type = 'memory';
      break;
    }
  }

  logger?.debug('[SkillStorageFactory] Created skill storage provider', {
    type,
    hasToolValidator: !!toolValidator,
    hasExternalProvider: !!extProvider,
  });

  return { provider, type, toolValidator, externalProvider: extProvider };
}

/**
 * Create an in-memory skill storage provider explicitly.
 *
 * @param options - Configuration options
 * @returns An in-memory skill storage provider
 */
export function createMemorySkillProvider(
  options: {
    toolRegistry?: ToolRegistryInterface;
    defaultTopK?: number;
    defaultMinScore?: number;
    logger?: FrontMcpLogger;
  } = {},
): SkillStorageFactoryResult {
  const { toolRegistry, defaultTopK, defaultMinScore, logger } = options;

  let toolValidator: SkillToolValidator | undefined;
  if (toolRegistry) {
    toolValidator = new SkillToolValidator(toolRegistry);
  }

  const provider = new MemorySkillProvider({
    defaultTopK,
    defaultMinScore,
    toolValidator,
  });

  logger?.debug('[SkillStorageFactory] Created explicit memory skill provider');

  return { provider, type: 'memory', toolValidator };
}
