/**
 * Base abstract class for all registries.
 *
 * Provides the core structure for managing tokens, definitions, and
 * dependency graphs. Subclasses implement specific initialization logic.
 */

import type { Token } from '../interfaces/base.interface.js';

/**
 * Result of the buildMap phase containing registry structures.
 */
export type RegistryBuildMapResult<Record> = {
  /** All tokens that are provided (graph nodes) */
  tokens: Set<Token>;
  /** Record definition by token */
  defs: Map<Token, Record>;
  /** Dependency graph by token */
  graph: Map<Token, Set<Token>>;
};

/**
 * Registry kind identifier for categorizing registries.
 */
export type RegistryKind = string;

/**
 * Abstract base class for registries.
 *
 * @typeParam Interface - The interface type for registry entries
 * @typeParam Record - The record type stored in the registry
 * @typeParam MetadataType - The metadata type for initialization
 * @typeParam ProviderRegistryType - Optional parent provider registry type
 */
export abstract class RegistryAbstract<Interface, Record, MetadataType, ProviderRegistryType = unknown> {
  /** Default timeout for async operations in milliseconds */
  protected asyncTimeoutMs = 30000;

  /** Promise that resolves when the registry is fully initialized */
  ready: Promise<void>;

  /** Reference to parent provider registry for dependency resolution */
  protected providers: ProviderRegistryType;

  /** Metadata used for initialization */
  protected list: MetadataType;

  /** All tokens that are provided (graph nodes) */
  protected tokens: Set<Token>;

  /** Record definition by token */
  protected defs: Map<Token, Record>;

  /** Dependency graph by token */
  protected graph: Map<Token, Set<Token>>;

  /** Instantiated entries by token */
  protected readonly instances: Map<Token<Interface>, Interface> = new Map();

  /**
   * Create a new registry.
   *
   * @param name - Registry kind name for identification
   * @param providers - Parent provider registry
   * @param metadata - Initialization metadata
   * @param auto - Whether to automatically build and initialize
   */
  protected constructor(name: RegistryKind, providers: ProviderRegistryType, metadata: MetadataType, auto = true) {
    // Register this registry with the parent provider registry if it supports it
    if (providers && typeof (providers as any).addRegistry === 'function') {
      (providers as any).addRegistry(name, this);
    }

    this.providers = providers;
    this.list = metadata;

    const { tokens, defs, graph } = this.buildMap(metadata);

    this.tokens = tokens;
    this.defs = defs;
    this.graph = graph;

    if (auto) {
      this.buildGraph();
      this.ready = this.initialize();
    } else {
      this.ready = Promise.resolve();
    }
  }

  /**
   * Build the initial token/record/graph maps from metadata.
   * Called during construction.
   *
   * @param list - Initialization metadata
   * @returns Registry structures
   */
  protected abstract buildMap(list: MetadataType): RegistryBuildMapResult<Record>;

  /**
   * Build the dependency graph.
   * Called after buildMap to establish dependencies.
   */
  protected abstract buildGraph(): void;

  /**
   * Initialize the registry by instantiating entries.
   * Called after buildGraph.
   *
   * @returns Promise that resolves when initialization is complete
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Check if the registry has any entries.
   */
  hasAny(): boolean {
    return this.instances.size > 0;
  }

  /**
   * Get all instances as a readonly map.
   */
  getAllInstances(): ReadonlyMap<Token<Interface>, Interface> {
    return this.instances;
  }
}
