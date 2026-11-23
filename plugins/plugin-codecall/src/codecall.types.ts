// file: libs/plugins/src/codecall/codecall.types.ts

import { z } from '@frontmcp/lazy-zod';
import type { StorageConfig } from '@frontmcp/utils';

// ===== Filter Function Types =====

/**
 * The tool's MCP annotations, as filters receive them.
 */
export interface CodeCallFilterToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

/**
 * Tool info passed to the directCalls filter function
 */
export interface DirectCallsFilterToolInfo {
  name: string;
  /** The qualified `<owner>:<name>` spelling. */
  fullName?: string;
  appId?: string;
  source?: string;
  description?: string;
  tags?: string[];
  /** The tool's MCP annotations (`readOnlyHint`, `destructiveHint`, ...). */
  annotations?: Readonly<CodeCallFilterToolAnnotations>;
  /** The tool's metadata as declared (`annotations`, `tags`, `codecall`, ...), read-only. */
  metadata?: Readonly<CodeCallFilterToolMetadata>;
}

/**
 * The tool's declared metadata, as filters receive it.
 */
export interface CodeCallFilterToolMetadata {
  name?: string;
  description?: string;
  tags?: string[];
  annotations?: Readonly<CodeCallFilterToolAnnotations>;
  codecall?: CodeCallToolMetadata;
  [key: string]: unknown;
}

/**
 * Tool info passed to the includeTools filter function
 */
export type IncludeToolsFilterToolInfo = DirectCallsFilterToolInfo;

/**
 * Function type for directCalls filter
 */
export type DirectCallsFilterFn = (tool: DirectCallsFilterToolInfo) => boolean;

/**
 * Function type for includeTools filter
 */
export type IncludeToolsFilterFn = (tool: IncludeToolsFilterToolInfo) => boolean;

// Helper schemas for filter functions with runtime validation
const directCallsFilterSchema = z.custom<DirectCallsFilterFn>((val) => typeof val === 'function', {
  message: 'filter must be a function with signature (tool: DirectCallsFilterToolInfo) => boolean',
});

const includeToolsFilterSchema = z.custom<IncludeToolsFilterFn>((val) => typeof val === 'function', {
  message: 'includeTools must be a function with signature (tool: IncludeToolsFilterToolInfo) => boolean',
});

// ===== Zod Schemas with Defaults =====

export const codeCallModeSchema = z
  .enum(['codecall_only', 'codecall_opt_in', 'metadata_driven'])
  .default('codecall_only');

export const codeCallVmPresetSchema = z.enum(['locked_down', 'secure', 'balanced', 'experimental']).default('secure');

/**
 * Where scripts run. `'interpreter'` is Enclave's AgentScript interpreter, which needs no Node module and so can run on
 * Node and in Cloudflare Workers. `'node-vm'` is Enclave's sandbox on Node's `vm` module: Node only.
 */
export const codeCallVmRuntimeSchema = z.enum(['node-vm', 'interpreter']);

/** The runtime when `vm.runtime` is unset. */
export const DEFAULT_VM_RUNTIME: CodeCallVmRuntime = 'node-vm';

/** The most tool calls `vm.maxToolCalls` (or `vm.maxSteps`) may allow one script. */
export const MAX_TOOL_CALLS = 100_000;

/**
 * Budgets only the `'interpreter'` runtime enforces. Each maximum is Enclave's own default or ceiling for the
 * interpreter, which Enclave's tests cover: a server may lower a budget, never raise it past that.
 */
export const INTERPRETER_BUDGET_LIMITS = {
  /**
   * Interpreter instructions per script. Measured on Node 24 (Apple M4 Pro), 1,000,000 steps ran in 0.3–1.1 s, inside
   * every preset's timeout; 5,000,000, Enclave's own default, took 1.9–5.1 s, past the `secure` preset's 3.5 s.
   */
  maxInterpreterSteps: { default: 1_000_000, max: 5_000_000 },
  /**
   * Bytes a script may allocate, by the interpreter's estimate; also the most its result may serialize to. The
   * default is Enclave's own `memoryLimit` default, the limit `'node-vm'` scripts run under; the maximum is the
   * interpreter's allocation ceiling.
   */
  memoryLimitBytes: { default: 1024 * 1024, max: 64 * 1024 * 1024 },
  /** How deep a script's calls may nest. */
  maxCallDepth: { default: 256, max: 256 },
  /** Calls of a script that may be unfinished at once, running or waiting. */
  maxPendingCalls: { default: 4096, max: 4096 },
} as const;

export type CodeCallInterpreterBudget = keyof typeof INTERPRETER_BUDGET_LIMITS;

const INTERPRETER_BUDGETS = Object.keys(INTERPRETER_BUDGET_LIMITS) as CodeCallInterpreterBudget[];

const interpreterBudgetSchema = (budget: CodeCallInterpreterBudget) =>
  z.number().int().min(1).max(INTERPRETER_BUDGET_LIMITS[budget].max).optional();

const toolCallBudgetSchema = z.number().int().min(1).max(MAX_TOOL_CALLS).optional();

// Default values for VM options
const DEFAULT_VM_OPTIONS = {
  preset: 'secure' as const,
};

export const codeCallVmOptionsSchema = z
  .object({
    /**
     * CSP-like preset; see README. It sets the syntax policy and the limits below, never the runtime.
     * @default 'secure'
     */
    preset: codeCallVmPresetSchema,

    /**
     * Where scripts run: `'node-vm'` (Node only) or `'interpreter'` (Node and Cloudflare Workers). Neither is a
     * process boundary: both run scripts in the server's own process.
     * @default 'node-vm'
     */
    runtime: codeCallVmRuntimeSchema.optional(),

    /**
     * Timeout for script execution in milliseconds
     * Defaults vary by preset
     */
    timeoutMs: z.number().positive().optional(),

    /**
     * Allow `for` loops besides `for-of`; false refuses every loop but `for-of` before the script runs.
     * The sandbox always refuses `while`, `do-while` and `for-in`.
     * Defaults vary by preset
     */
    allowLoops: z.boolean().optional(),

    /**
     * Tool calls one script may make, `callTool()`, namespace methods and `parallel()` calls alike; one more fails
     * the script. An integer from 1 to 100,000.
     * Defaults vary by preset (secure: 5000)
     */
    maxToolCalls: toolCallBudgetSchema,

    /**
     * @deprecated The old name of `maxToolCalls`, with the same meaning: tool calls, not interpreter steps. Setting
     * both to different values is refused.
     */
    maxSteps: toolCallBudgetSchema,

    /**
     * Interpreter instructions one script may run (`runtime: 'interpreter'` only). An integer from 1 to 5,000,000.
     * @default 1_000_000
     */
    maxInterpreterSteps: interpreterBudgetSchema('maxInterpreterSteps'),

    /**
     * Bytes one script may allocate, by the interpreter's estimate, and the most its result may serialize to
     * (`runtime: 'interpreter'` only). An integer from 1 to 64 MiB.
     * @default 1_048_576 (1 MiB)
     */
    memoryLimitBytes: interpreterBudgetSchema('memoryLimitBytes'),

    /**
     * How deep a script's calls may nest (`runtime: 'interpreter'` only). An integer from 1 to 256.
     * @default 256
     */
    maxCallDepth: interpreterBudgetSchema('maxCallDepth'),

    /**
     * Calls of a script that may be unfinished at once, running or waiting (`runtime: 'interpreter'` only). An
     * integer from 1 to 4096.
     * @default 4096
     */
    maxPendingCalls: interpreterBudgetSchema('maxPendingCalls'),

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
     * Give scripts `console`: with `true`, a script's `console.log`, `info`, `warn`, `error` and `debug` write to the
     * server's logger (logger `CodeCall:script`; `log` and `info` at info level), each call one line. The sandbox
     * bounds each script's console calls and bytes, and the server writes at most 50 script lines a second across
     * all scripts, dropping the rest. Without it a script that uses `console` is refused before it runs.
     *
     * Only an explicit `true` here turns it on: no preset does, whatever its other defaults.
     * @default false
     */
    allowConsole: z.boolean().optional(),

    /**
     * Maximum nesting depth for sanitized output values
     * Prevents deeply nested objects from causing stack overflow
     * @default varies by preset (secure: 50)
     */
    maxSanitizeDepth: z.number().positive().optional(),

    /**
     * Maximum properties per object in sanitized output values
     * Limits array sizes and object keys in return values
     * @default varies by preset (secure: 2000)
     */
    maxSanitizeProperties: z.number().positive().optional(),

    /**
     * Calls a script may make to one tool within about 2 seconds; one more stops the script with
     * `[RAPID_ENUMERATION]`. Calls made through `parallel()` count. The sandbox's message says "in 5s",
     * but it keeps only the last 2 seconds of calls.
     * @default 30
     */
    rapidEnumerationThreshold: z.number().int().positive().optional(),

    /**
     * Per-tool values of `rapidEnumerationThreshold`, by tool name, e.g. `{ 'users:get': 100 }`.
     */
    rapidEnumerationOverrides: z.record(z.string(), z.number().int().positive()).optional(),
  })
  .superRefine((vm, ctx) => {
    if (vm.maxSteps !== undefined && vm.maxToolCalls !== undefined && vm.maxSteps !== vm.maxToolCalls) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSteps'],
        message: `vm.maxSteps is the deprecated name of vm.maxToolCalls, and they differ (${vm.maxSteps} and ${vm.maxToolCalls}): set only vm.maxToolCalls`,
      });
    }
    const runtime = vm.runtime ?? DEFAULT_VM_RUNTIME;
    if (runtime === 'interpreter') return;
    for (const budget of INTERPRETER_BUDGETS) {
      if (vm[budget] === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [budget],
        message: `vm.${budget} applies only to vm.runtime 'interpreter'; the '${runtime}' runtime does not enforce it`,
      });
    }
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
   * Optional advanced filter function.
   * Signature: (tool: DirectCallsFilterToolInfo) => boolean
   */
  filter: directCallsFilterSchema.optional(),
});

export const embeddingStrategySchema = z.enum(['tfidf', 'ml']).default('tfidf');

// Synonym expansion configuration schema
export const synonymExpansionConfigSchema = z
  .object({
    /**
     * Enable/disable synonym expansion for TF-IDF search.
     * When enabled, queries are expanded with synonyms to improve relevance.
     * For example, "add user" will also match tools containing "create user".
     * @default true
     */
    enabled: z.boolean().default(true),

    /**
     * Additional synonym groups beyond the defaults.
     * Each group is an array of related terms that should be treated as equivalent.
     * @example [['customer', 'client', 'buyer'], ['order', 'purchase', 'transaction']]
     */
    additionalSynonyms: z.array(z.array(z.string())).optional(),

    /**
     * Replace default synonyms entirely with additionalSynonyms.
     * @default false
     */
    replaceDefaults: z.boolean().default(false),

    /**
     * Maximum number of synonym expansions per term.
     * Prevents query explosion for terms with many synonyms.
     * @default 5
     */
    maxExpansionsPerTerm: z.number().positive().default(5),
  })
  .default({ enabled: true, replaceDefaults: false, maxExpansionsPerTerm: 5 });

// Default values for embedding options
const DEFAULT_EMBEDDING_OPTIONS = {
  strategy: 'tfidf' as const,
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './.cache/transformers',
  useHNSW: false,
  synonymExpansion: { enabled: true, replaceDefaults: false, maxExpansionsPerTerm: 5 },
};

export const codeCallEmbeddingOptionsSchema = z
  .object({
    /**
     * Embedding strategy to use for tool search
     * - 'tfidf': Lightweight, synchronous TF-IDF based search (no ML models required)
     * - 'ml': ML-based semantic search using transformers.js (better quality, requires model download)
     * @default 'tfidf'
     */
    strategy: embeddingStrategySchema.optional(),

    /**
     * Model name for ML-based embeddings (only used when strategy='ml')
     * @default 'Xenova/all-MiniLM-L6-v2'
     */
    modelName: z.string().optional(),

    /**
     * Cache directory for ML models (only used when strategy='ml')
     * @default './.cache/transformers'
     */
    cacheDir: z.string().optional(),

    /**
     * Enable HNSW index for faster search (only used when strategy='ml')
     * When enabled, provides O(log n) search instead of O(n) brute-force
     * @default false
     */
    useHNSW: z.boolean().optional(),

    /**
     * Synonym expansion configuration for TF-IDF search.
     * When enabled, queries like "add user" will match tools for "create user".
     * Only applies when strategy is 'tfidf' (ML already handles semantic similarity).
     * Set to false to disable, or provide a config object to customize.
     * @default { enabled: true }
     */
    synonymExpansion: z.union([z.literal(false), synonymExpansionConfigSchema]).optional(),
  })
  .optional()
  .transform((opts) => ({
    strategy: opts?.strategy ?? DEFAULT_EMBEDDING_OPTIONS.strategy,
    modelName: opts?.modelName ?? DEFAULT_EMBEDDING_OPTIONS.modelName,
    cacheDir: opts?.cacheDir ?? DEFAULT_EMBEDDING_OPTIONS.cacheDir,
    useHNSW: opts?.useHNSW ?? DEFAULT_EMBEDDING_OPTIONS.useHNSW,
    synonymExpansion: opts?.synonymExpansion ?? DEFAULT_EMBEDDING_OPTIONS.synonymExpansion,
  }));

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

/** How many run records a memory store holds at once, dropping the oldest, unless `runs.storage.memory.maxEntries` is set. */
export const DEFAULT_RUNS_MEMORY_MAX_ENTRIES = 1000;

export const codeCallRunsOptionsSchema = z
  .object({
    /** Keep a record of each `codecall:execute` run that has an owner, a session or a signed-in caller (true by default). */
    enabled: z.boolean().default(true),
    /** How long a run record can be read, in seconds (600 by default). */
    ttlSeconds: z.number().int().min(1).default(600),
    /** The most one record may take as UTF-8 JSON; journal entries past it are left out and counted (256 KiB by default). */
    maxRecordBytes: z
      .number()
      .int()
      .min(1024)
      .default(256 * 1024),
    /** Keep each call's result in its journal entry, for resuming a run (false by default). */
    resume: z.boolean().default(false),
    /** Where records are kept, through `createStorage()` from `@frontmcp/utils` ({ type: 'auto' }, 1000 at most in memory). */
    storage: z
      .custom<StorageConfig>((value) => typeof value === 'object' && value !== null && !Array.isArray(value), {
        message: 'must be a storage config, such as { type: "redis", redis: { url } }',
      })
      .default({ type: 'auto' })
      .transform((storage) => ({
        ...storage,
        memory: { maxEntries: DEFAULT_RUNS_MEMORY_MAX_ENTRIES, ...storage.memory },
      })),
    /** The key prefix of run records in the storage ('codecall-runs'). */
    namespace: z.string().min(1).default('codecall-runs'),
  })
  .prefault({});

/** Which runs' tool calls `codecall:execute` lists in its result. */
export const codeCallTraceLevelSchema = z.enum(['off', 'failure', 'calls']);

export const codeCallTraceOptionsSchema = z
  .object({
    /** Which runs' calls `trace` lists: 'off', 'failure' (a failed run's) or 'calls' (every run's) ('failure'). */
    level: codeCallTraceLevelSchema.default('failure'),
    /** The most lines one trace has; earlier calls past it are counted in its first line (20). */
    maxLines: z.number().int().min(1).max(1000).default(20),
    /** Show each call's arguments and result, cut to 200 characters, in the trace and the spans (false). */
    values: z.boolean().default(false),
  })
  .prefault({});

// Inner schema without the outer .default() - used for extracting input type
const codeCallPluginOptionsObjectSchema = z.object({
  /**
   * CodeCall mode
   * @default 'codecall_only'
   */
  mode: codeCallModeSchema,

  /**
   * App IDs that CodeCall manages. When set, `codecall_only` mode only hides tools
   * from these apps — tools from other apps remain visible in list_tools.
   * When unset (default), all tools in the server are affected.
   * @example ['ecommerce'] — only hide ecommerce app tools, keep calc tools visible
   */
  appIds: z.array(z.string()).optional(),

  /**
   * Search results per query when a `codecall:search` call names no `topK`
   * @default 8
   */
  topK: z.number().positive().default(8),

  /**
   * Most tool definitions one `codecall:describe` call returns; a call that would describe more is refused
   * @default 8
   */
  maxDefinitions: z.number().int().positive().default(8),

  /**
   * Optional filter function for including tools.
   * Signature: (tool: IncludeToolsFilterToolInfo) => boolean
   */
  includeTools: includeToolsFilterSchema.optional(),

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

  /** A record of each `codecall:execute` run, with a journal of its tool calls, readable by its owner. */
  runs: codeCallRunsOptionsSchema,

  /** The trace of tool calls `codecall:execute` returns to the agent. */
  trace: codeCallTraceOptionsSchema,
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
export const codeCallPluginOptionsSchema = codeCallPluginOptionsObjectSchema.prefault(DEFAULT_PLUGIN_OPTIONS);

// ===== TypeScript Types =====

// Output types (after parsing, with defaults applied) - use for internal plugin logic
export type CodeCallMode = z.infer<typeof codeCallModeSchema>;
export type CodeCallVmPreset = z.infer<typeof codeCallVmPresetSchema>;
export type CodeCallVmRuntime = z.infer<typeof codeCallVmRuntimeSchema>;
export type CodeCallVmOptions = z.infer<typeof codeCallVmOptionsSchema>;
export type CodeCallDirectCallsOptions = z.infer<typeof codeCallDirectCallsOptionsSchema>;
export type EmbeddingStrategy = z.infer<typeof embeddingStrategySchema>;
export type SynonymExpansionConfig = z.infer<typeof synonymExpansionConfigSchema>;
export type CodeCallSidecarOptions = z.infer<typeof codeCallSidecarOptionsSchema>;
export type CodeCallRunsOptions = z.infer<typeof codeCallRunsOptionsSchema>;
export type CodeCallTraceLevel = z.infer<typeof codeCallTraceLevelSchema>;
export type CodeCallTraceOptions = z.infer<typeof codeCallTraceOptionsSchema>;

export type CodeCallEmbeddingOptions = z.infer<typeof codeCallEmbeddingOptionsSchema>;
export type CodeCallEmbeddingOptionsInput = z.input<typeof codeCallEmbeddingOptionsSchema>;

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
   *
   * A tool CodeCall hides is reachable only through CodeCall: a client's direct `tools/call` of
   * it is refused as for an unknown tool. Set this on a tool a client or widget calls directly.
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
