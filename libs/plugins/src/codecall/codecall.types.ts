// file: libs/plugins/src/codecall/codecall.types.ts

export type CodeCallMode = 'codecall_only' | 'codecall_opt_in' | 'metadata_driven';

export type CodeCallVmPreset = 'locked_down' | 'secure' | 'balanced' | 'experimental';

export interface CodeCallVmOptions {
  /**
   * CSP-like preset; see README.
   * @default 'secure'
   */
  preset?: CodeCallVmPreset;

  timeoutMs?: number;
  allowLoops?: boolean;
  maxSteps?: number;
  disabledBuiltins?: string[];
  disabledGlobals?: string[];
  allowConsole?: boolean;
}

export interface CodeCallDirectCallsOptions {
  /**
   * Enable/disable the `codecall.invoke` meta-tool.
   */
  enabled: boolean;

  /**
   * Optional allowlist of tool names.
   */
  allowedTools?: string[];

  /**
   * Optional advanced filter.
   */
  filter?: (tool: { name: string; appId?: string; source?: string; tags?: string[] }) => boolean;
}

/**
 * Embedding strategy for tool search
 */
export type EmbeddingStrategy = 'tfidf' | 'ml';

/**
 * Configuration for tool search embeddings
 */
export interface CodeCallEmbeddingOptions {
  /**
   * Embedding strategy to use for tool search
   * - 'tfidf': Lightweight, synchronous TF-IDF based search (no ML models required)
   * - 'ml': ML-based semantic search using transformers.js (better quality, requires model download)
   * @default 'tfidf'
   */
  strategy?: EmbeddingStrategy;

  /**
   * Model name for ML-based embeddings (only used when strategy='ml')
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  modelName?: string;

  /**
   * Cache directory for ML models (only used when strategy='ml')
   * @default './.cache/transformers'
   */
  cacheDir?: string;

  /**
   * Enable HNSW index for faster search (only used when strategy='ml')
   * When enabled, provides O(log n) search instead of O(n) brute-force
   * @default false
   */
  useHNSW?: boolean;
}

/**
 * Plugin-level options (from README).
 */
export interface CodeCallPluginOptions {
  mode?: CodeCallMode;
  topK?: number;
  maxDefinitions?: number;

  includeTools?: (tool: {
    name: string;
    appId?: string;
    source?: string;
    description?: string;
    tags?: string[];
  }) => boolean;

  directCalls?: CodeCallDirectCallsOptions;
  vm?: CodeCallVmOptions;

  /**
   * Embedding configuration for tool search
   */
  embedding?: CodeCallEmbeddingOptions;
}

/**
 * Per-tool metadata used by CodeCall.
 * This maps to `metadata.codecall` on tools.
 */
export interface CodeCallToolMetadata {
  /**
   * If true, this tool stays visible in `list_tools`
   * even when CodeCall is hiding most tools.
   */
  visibleInListTools?: boolean;

  /**
   * Whether this tool can be used via CodeCall.
   * Semantics depend on CodeCallMode (see README).
   */
  enabledInCodeCall?: boolean;

  /** Optional extra indexing hints */
  appId?: string;
  source?: string;
  tags?: string[];
}

// ----- meta-tool contracts -----

export type CodeCallSearchInput = {
  query: string;
  topK?: number;
  filter?: {
    appIds?: string[];
    tags?: string[];
    includeOpenApi?: boolean;
    includeInline?: boolean;
  };
};

export type CodeCallSearchResult = {
  tools: {
    name: string;
    description: string;
    appId?: string;
    source?: string;
    score: number;
  }[];
};

export type CodeCallDescribeInput = {
  tools: string[];
  max?: number;
};

export type CodeCallDescribeResult = {
  tools: {
    name: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown | null;
    examples?: {
      input: unknown;
      output?: unknown;
    }[];
  }[];
};

export type CodeCallExecuteInput = {
  script: string;
  /**
   * Arbitrary, readonly context exposed as `codecallContext`.
   */
  context?: Record<string, unknown>;
};

// ---- global FrontMCP metadata extension ----

declare global {
  interface ExtendFrontMcpToolMetadata {
    /**
     * CodeCall-specific metadata, attached via `@Tool({ metadata: { codecall: ... } })`
     * or whatever your decorator mapping is.
     */
    codecall?: CodeCallToolMetadata;
  }
}
