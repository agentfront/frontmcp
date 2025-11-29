// file: libs/plugins/src/codecall/codecall.types.ts

import { z } from 'zod';

// ===== Zod Schemas with Defaults =====

export const codeCallModeSchema = z
  .enum(['codecall_only', 'codecall_opt_in', 'metadata_driven'])
  .default('codecall_only');

export const codeCallVmPresetSchema = z.enum(['locked_down', 'secure', 'balanced', 'experimental']).default('secure');

// Default values for VM options
const DEFAULT_VM_OPTIONS = {
  preset: 'secure' as const,
};

export const codeCallVmOptionsSchema = z
  .object({
    /**
     * CSP-like preset; see README.
     * @default 'secure'
     */
    preset: codeCallVmPresetSchema,

    /**
     * Timeout for script execution in milliseconds
     * Defaults vary by preset
     */
    timeoutMs: z.number().positive().optional(),

    /**
     * Allow loop constructs (for, while, do-while)
     * Defaults vary by preset
     */
    allowLoops: z.boolean().optional(),

    /**
     * Maximum number of steps (if applicable)
     * Defaults vary by preset
     */
    maxSteps: z.number().positive().optional(),

    /**
     * List of disabled builtin functions
     * Defaults vary by preset
     */
    disabledBuiltins: z.array(z.string()).optional(),

    /**
     * List of disabled global variables
     * Defaults vary by preset
     */
    disabledGlobals: z.array(z.string()).optional(),

    /**
     * Allow console.log/warn/error
     * Defaults vary by preset
     */
    allowConsole: z.boolean().optional(),
  })
  .default(() => DEFAULT_VM_OPTIONS);

export const codeCallDirectCallsOptionsSchema = z.object({
  /**
   * Enable/disable the `codecall.invoke` meta-tool.
   */
  enabled: z.boolean(),

  /**
   * Optional allowlist of tool names.
   */
  allowedTools: z.array(z.string()).optional(),

  /**
   * Optional advanced filter.
   * Note: Functions can't be validated by Zod at runtime, so this is any
   */
  filter: z
    .function({
      input: z.tuple([
        z.object({
          name: z.string(),
          appId: z.string().optional(),
          source: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      ]),
      output: z.boolean(),
    })
    .optional(),
});

export const embeddingStrategySchema = z.enum(['tfidf', 'ml']).default('tfidf');

// Default values for embedding options
const DEFAULT_EMBEDDING_OPTIONS = {
  strategy: 'tfidf' as const,
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './.cache/transformers',
  useHNSW: false,
};

export const codeCallEmbeddingOptionsSchema = z
  .object({
    /**
     * Embedding strategy to use for tool search
     * - 'tfidf': Lightweight, synchronous TF-IDF based search (no ML models required)
     * - 'ml': ML-based semantic search using transformers.js (better quality, requires model download)
     * @default 'tfidf'
     */
    strategy: embeddingStrategySchema,

    /**
     * Model name for ML-based embeddings (only used when strategy='ml')
     * @default 'Xenova/all-MiniLM-L6-v2'
     */
    modelName: z.string().default('Xenova/all-MiniLM-L6-v2'),

    /**
     * Cache directory for ML models (only used when strategy='ml')
     * @default './.cache/transformers'
     */
    cacheDir: z.string().default('./.cache/transformers'),

    /**
     * Enable HNSW index for faster search (only used when strategy='ml')
     * When enabled, provides O(log n) search instead of O(n) brute-force
     * @default false
     */
    useHNSW: z.boolean().default(false),
  })
  .default(() => DEFAULT_EMBEDDING_OPTIONS);

export const codeCallSidecarOptionsSchema = z
  .object({
    /**
     * Enable pass-by-reference support via sidecar
     * When enabled, large strings are automatically lifted to a sidecar
     * and resolved at the callTool boundary
     * @default false
     */
    enabled: z.boolean().default(false),

    /**
     * Maximum total size of all stored references in bytes
     * @default 16MB (from security level)
     */
    maxTotalSize: z.number().positive().optional(),

    /**
     * Maximum size of a single reference in bytes
     * @default 4MB (from security level)
     */
    maxReferenceSize: z.number().positive().optional(),

    /**
     * Threshold in bytes to trigger extraction from source code
     * Strings larger than this are lifted to the sidecar
     * @default 64KB (from security level)
     */
    extractionThreshold: z.number().positive().optional(),

    /**
     * Maximum expanded size when resolving references for tool calls
     * @default 8MB (from security level)
     */
    maxResolvedSize: z.number().positive().optional(),

    /**
     * Whether to allow composite handles from string concatenation
     * If false, concatenating references throws an error
     * @default false (strict mode)
     */
    allowComposites: z.boolean().optional(),

    /**
     * Maximum script length (in characters) when sidecar is disabled
     * Prevents large inline data from being embedded in script
     * If null, no limit is enforced
     * @default 64KB
     */
    maxScriptLengthWhenDisabled: z
      .number()
      .positive()
      .nullable()
      .default(64 * 1024),
  })
  .default(() => ({
    enabled: false,
    maxScriptLengthWhenDisabled: 64 * 1024,
  }));

// Inner schema without the outer .default() - used for extracting input type
const codeCallPluginOptionsObjectSchema = z.object({
  /**
   * CodeCall mode
   * @default 'codecall_only'
   */
  mode: codeCallModeSchema,

  /**
   * Default number of tools to return in search results
   * @default 8
   */
  topK: z.number().positive().default(8),

  /**
   * Maximum number of tool definitions to include
   * @default 8
   */
  maxDefinitions: z.number().positive().default(8),

  /**
   * Optional filter function for including tools
   * Note: Functions can't be validated by Zod at runtime
   */
  includeTools: z
    .function({
      input: z.tuple([
        z.object({
          name: z.string(),
          appId: z.string().optional(),
          source: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      ]),
      output: z.boolean(),
    })
    .optional(),

  /**
   * Direct calls configuration
   */
  directCalls: codeCallDirectCallsOptionsSchema.optional(),

  /**
   * VM execution options
   */
  vm: codeCallVmOptionsSchema,

  /**
   * Embedding configuration for tool search
   */
  embedding: codeCallEmbeddingOptionsSchema,

  /**
   * Sidecar (pass-by-reference) configuration
   * When enabled, large data is stored outside the sandbox and resolved at callTool boundary
   */
  sidecar: codeCallSidecarOptionsSchema,
});

// Default values for plugin options
const DEFAULT_PLUGIN_OPTIONS = {
  mode: 'codecall_only' as const,
  topK: 8,
  maxDefinitions: 8,
  vm: DEFAULT_VM_OPTIONS,
  embedding: DEFAULT_EMBEDDING_OPTIONS,
  sidecar: {
    enabled: false,
    maxScriptLengthWhenDisabled: 64 * 1024,
  },
};

// Full schema with default - used for parsing
export const codeCallPluginOptionsSchema = codeCallPluginOptionsObjectSchema.default(() => DEFAULT_PLUGIN_OPTIONS);

// ===== TypeScript Types =====

// Output types (after parsing, with defaults applied) - use for internal plugin logic
export type CodeCallMode = z.infer<typeof codeCallModeSchema>;
export type CodeCallVmPreset = z.infer<typeof codeCallVmPresetSchema>;
export type CodeCallVmOptions = z.infer<typeof codeCallVmOptionsSchema>;
export type CodeCallDirectCallsOptions = z.infer<typeof codeCallDirectCallsOptionsSchema>;
export type EmbeddingStrategy = z.infer<typeof embeddingStrategySchema>;
export type CodeCallEmbeddingOptions = z.infer<typeof codeCallEmbeddingOptionsSchema>;
export type CodeCallSidecarOptions = z.infer<typeof codeCallSidecarOptionsSchema>;

/**
 * Resolved options type (after parsing with defaults applied).
 * Use this for internal plugin logic where all defaults are guaranteed.
 */
export type CodeCallPluginOptions = z.infer<typeof codeCallPluginOptionsSchema>;

/**
 * Input options type (what users provide to init()).
 * All fields with defaults are optional.
 */
export type CodeCallPluginOptionsInput = z.input<typeof codeCallPluginOptionsObjectSchema>;

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
