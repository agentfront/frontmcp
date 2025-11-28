/**
 * AI Scoring Gate Types and Interfaces
 *
 * Core types for the semantic security scoring system that detects
 * attack patterns beyond what static AST validation can catch.
 *
 * @packageDocumentation
 */

/**
 * Scorer implementation types
 *
 * - `disabled`: No scoring, pass-through mode (0ms latency)
 * - `rule-based`: Pure TypeScript rules, zero dependencies (~1ms latency)
 * - `local-llm`: On-device LLM scoring (~5-10ms latency, model download required)
 * - `external-api`: External API-based scoring (~100ms latency, best detection)
 * - `progressive`: Fast rule-based check, escalate to ML if suspicious
 */
export type ScorerType = 'disabled' | 'rule-based' | 'local-llm' | 'external-api' | 'progressive';

/**
 * Scoring strategy types
 *
 * - `single`: Use a single scorer (legacy behavior)
 * - `progressive`: Fast check first, escalate to detailed if suspicious
 */
export type ScoringStrategy = 'single' | 'progressive';

/**
 * Risk level classification
 */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Categories of sensitive data that may be accessed
 */
export type SensitiveCategory =
  | 'authentication' // password, token, secret, apiKey
  | 'pii' // email, ssn, phone, creditCard
  | 'financial' // bankAccount, routing
  | 'internal'; // __internal, _private

/**
 * Rule IDs for detection rules
 */
export type RuleId =
  | 'SENSITIVE_FIELD' // Queries password/token/secret fields
  | 'EXCESSIVE_LIMIT' // limit > 10,000
  | 'WILDCARD_QUERY' // query="*" or filter={}
  | 'LOOP_TOOL_CALL' // callTool inside for/for-of
  | 'EXFIL_PATTERN' // list→send or query→export sequence
  | 'EXTREME_VALUE' // numeric arg > 1,000,000
  | 'DYNAMIC_TOOL' // Variable tool name (not static)
  | 'BULK_OPERATION'; // Tool name contains bulk/batch/all

/**
 * Individual tool call extracted from the code
 */
export interface ExtractedToolCall {
  /**
   * The tool name (e.g., 'users:list', 'billing:getInvoices')
   */
  toolName: string;

  /**
   * Whether the tool name is a static string literal
   * Dynamic tool names are more suspicious
   */
  isStaticName: boolean;

  /**
   * Keys of arguments passed to the tool
   */
  argumentKeys: string[];

  /**
   * String literals found in arguments
   */
  stringLiterals: string[];

  /**
   * Numeric literals found in arguments
   */
  numericLiterals: number[];

  /**
   * Whether this call is inside a loop
   */
  insideLoop: boolean;

  /**
   * How deeply nested in loops (0 = not in loop)
   */
  loopDepth: number;

  /**
   * Source location for debugging
   */
  location: { line: number; column: number };
}

/**
 * Pattern signals extracted from the code
 */
export interface PatternSignals {
  /**
   * Total number of tool calls in the code
   */
  totalToolCalls: number;

  /**
   * Number of unique tools called
   */
  uniqueToolsCount: number;

  /**
   * Tool names that are called inside loops (fan-out risk)
   */
  toolsInLoops: string[];

  /**
   * Maximum loop nesting depth
   */
  maxLoopNesting: number;

  /**
   * Sequence of tool calls in order (for exfiltration detection)
   * Only includes static tool names
   */
  toolSequence: string[];

  /**
   * Whether the code iterates over tool results
   */
  iteratesOverToolResults: boolean;
}

/**
 * Numeric signals extracted from the code
 */
export interface NumericSignals {
  /**
   * Maximum limit/pageSize value found
   */
  maxLimit: number;

  /**
   * Maximum string length in arguments
   */
  maxStringLength: number;

  /**
   * Tool call density (calls per line)
   */
  toolCallDensity: number;

  /**
   * Computed fan-out risk score (0-100)
   */
  fanOutRisk: number;
}

/**
 * Sensitive field access detected in the code
 */
export interface SensitiveAccess {
  /**
   * Field names that may contain sensitive data
   */
  fieldsAccessed: string[];

  /**
   * Categories of sensitive data that may be accessed
   */
  categories: SensitiveCategory[];
}

/**
 * Metadata about the feature extraction
 */
export interface ExtractionMeta {
  /**
   * Time taken to extract features in milliseconds
   */
  extractionTimeMs: number;

  /**
   * SHA-256 hash of the code (for caching)
   */
  codeHash: string;

  /**
   * Number of lines in the code
   */
  lineCount: number;
}

/**
 * Complete features extracted from code for scoring
 */
export interface ExtractedFeatures {
  /**
   * Individual tool calls extracted
   */
  toolCalls: ExtractedToolCall[];

  /**
   * Pattern-based signals
   */
  patterns: PatternSignals;

  /**
   * Numeric signals
   */
  signals: NumericSignals;

  /**
   * Sensitive data access detection
   */
  sensitive: SensitiveAccess;

  /**
   * Extraction metadata
   */
  meta: ExtractionMeta;
}

/**
 * Individual risk signal from a scorer
 */
export interface RiskSignal {
  /**
   * Rule identifier
   */
  id: RuleId | string;

  /**
   * Risk score contribution (0-100)
   */
  score: number;

  /**
   * Human-readable description
   */
  description: string;

  /**
   * Risk level
   */
  level: RiskLevel;

  /**
   * Additional context data
   */
  context?: Record<string, unknown>;
}

/**
 * Result from a scorer
 */
export interface ScoringResult {
  /**
   * Total risk score (0-100)
   */
  totalScore: number;

  /**
   * Overall risk level
   */
  riskLevel: RiskLevel;

  /**
   * Individual risk signals
   */
  signals: RiskSignal[];

  /**
   * Time taken to score in milliseconds
   */
  scoringTimeMs: number;

  /**
   * Scorer that produced this result
   */
  scorerType: ScorerType;
}

/**
 * Result from the scoring gate evaluation
 */
export interface ScoringGateResult {
  /**
   * Whether execution is allowed
   */
  allowed: boolean;

  /**
   * Whether a warning was triggered (score >= warnThreshold but < blockThreshold)
   */
  warned?: boolean;

  /**
   * Total risk score (0-100)
   */
  totalScore?: number;

  /**
   * Overall risk level
   */
  riskLevel?: RiskLevel;

  /**
   * Individual risk signals
   */
  signals?: RiskSignal[];

  /**
   * Human-readable reason for the decision
   */
  reason?: string;

  /**
   * Total evaluation time in milliseconds
   */
  latencyMs: number;

  /**
   * Whether the result was served from cache
   */
  cached: boolean;

  /**
   * Feature extraction time (if not cached)
   */
  extractionTimeMs?: number;

  /**
   * Scoring time (if not cached)
   */
  scoringTimeMs?: number;
}

/**
 * Configuration for VectoriaDB-based similarity scoring
 */
export interface VectoriaConfigForScoring {
  /**
   * Path to pre-built index with malicious patterns
   */
  indexPath?: string;

  /**
   * Similarity threshold (0-1) for considering a match
   * @default 0.85
   */
  threshold?: number;
}

/**
 * Configuration for local LLM scorer
 */
export interface LocalLlmConfig {
  /**
   * Model identifier from HuggingFace
   * @example 'Xenova/codebert-base', 'Xenova/all-MiniLM-L6-v2'
   */
  modelId: 'Xenova/codebert-base' | 'Xenova/all-MiniLM-L6-v2' | string;

  /**
   * Scoring mode
   * - classification: Use text classification model for direct scoring
   * - similarity: Use embeddings + VectoriaDB for similarity-based scoring
   * @default 'classification'
   */
  mode?: 'classification' | 'similarity';

  /**
   * Model cache directory
   * @default '~/.frontmcp/models'
   */
  cacheDir?: string;

  /**
   * Configuration for similarity mode (VectoriaDB)
   * Required when mode='similarity'
   */
  vectoriaConfig?: VectoriaConfigForScoring;

  /**
   * Whether to fall back to rule-based scorer on model errors
   * @default true
   */
  fallbackToRules?: boolean;

  /**
   * @deprecated Use cacheDir instead
   */
  modelDir?: string;

  /**
   * @deprecated Not used in new implementation
   */
  quantization?: 'int4' | 'int8' | 'fp16';

  /**
   * @deprecated Not used in new implementation
   */
  maxTokens?: number;
}

/**
 * Configuration for external API scorer
 */
export interface ExternalApiConfig {
  /**
   * API endpoint URL
   * @example 'https://api.example.com/score'
   */
  endpoint: string;

  /**
   * API key for authentication (sent as Bearer token)
   */
  apiKey?: string;

  /**
   * Request timeout in milliseconds
   * @default 5000
   */
  timeoutMs?: number;

  /**
   * Additional headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Number of retries on failure
   * @default 1
   */
  retries?: number;
}

/**
 * Configuration for progressive scoring strategy
 *
 * Fast rule-based check first, escalate to detailed ML scoring
 * if the initial score exceeds the escalation threshold.
 */
export interface ProgressiveScoringConfig {
  /**
   * Strategy type identifier
   */
  strategy: 'progressive';

  /**
   * Fast initial scorer configuration (always rule-based)
   */
  fast: {
    type: 'rule-based';
    customRules?: Record<string, number>;
  };

  /**
   * Detailed follow-up scorer configuration
   */
  detailed: {
    type: 'local-llm' | 'external-api';
    localLlm?: LocalLlmConfig;
    externalApi?: ExternalApiConfig;
  };

  /**
   * Score threshold to trigger detailed scoring
   * If fast scorer returns >= this value, detailed scorer runs
   * @default 30
   */
  escalationThreshold?: number;

  /**
   * How to combine fast and detailed scores
   * - 'replace': Use detailed score only
   * - 'max': Use higher of the two scores
   * - 'avg': Average of both scores
   * @default 'max'
   */
  combination?: 'replace' | 'max' | 'avg';
}

/**
 * Default values for progressive scoring
 */
export const DEFAULT_PROGRESSIVE_CONFIG = {
  escalationThreshold: 30,
  combination: 'max' as const,
};

/**
 * Configuration for scoring cache
 */
export interface ScoringCacheConfig {
  /**
   * Whether caching is enabled
   * @default true
   */
  enabled: boolean;

  /**
   * Cache entry time-to-live in milliseconds
   * @default 300000 (5 minutes)
   */
  ttlMs?: number;

  /**
   * Maximum number of cached entries
   * @default 1000
   */
  maxEntries?: number;
}

/**
 * Configuration for the scoring gate
 *
 * Supports two configuration styles:
 * 1. Legacy single-scorer mode: Use `scorer` property
 * 2. Progressive mode: Use `scoring` property with ProgressiveScoringConfig
 *
 * @example
 * // Legacy single-scorer mode
 * { scorer: 'rule-based', blockThreshold: 70 }
 *
 * @example
 * // Progressive mode
 * {
 *   scoring: {
 *     strategy: 'progressive',
 *     fast: { type: 'rule-based' },
 *     detailed: { type: 'local-llm', localLlm: { modelId: 'Xenova/codebert-base' } },
 *     escalationThreshold: 30
 *   },
 *   blockThreshold: 70
 * }
 */
export interface ScoringGateConfig {
  /**
   * Scorer mode to use (legacy single-scorer mode)
   * Mutually exclusive with `scoring` property
   * @default 'disabled'
   */
  scorer?: ScorerType;

  /**
   * Progressive scoring configuration (new mode)
   * Mutually exclusive with `scorer` property
   * Takes precedence over `scorer` if both are provided
   */
  scoring?: ProgressiveScoringConfig;

  /**
   * Score threshold for blocking execution (0-100)
   * Scripts with scores >= this value will be blocked
   * @default 70
   */
  blockThreshold?: number;

  /**
   * Score threshold for warning (0-100)
   * Scripts with scores >= this value will log a warning
   * @default 40
   */
  warnThreshold?: number;

  /**
   * Configuration for local LLM scorer
   * Required when scorer='local-llm'
   */
  localLlm?: LocalLlmConfig;

  /**
   * Configuration for external API scorer
   * Required when scorer='external-api'
   */
  externalApi?: ExternalApiConfig;

  /**
   * Cache configuration
   */
  cache?: ScoringCacheConfig;

  /**
   * Behavior on scoring errors
   *
   * - true (fail-open): Allow execution if scoring fails
   * - false (fail-closed): Block execution if scoring fails
   *
   * @default true
   */
  failOpen?: boolean;

  /**
   * Custom rules to add or override for rule-based scorer
   */
  customRules?: Record<string, number>;

  /**
   * Log detailed scoring information
   * @default false
   */
  verbose?: boolean;
}

/**
 * Default scoring gate configuration
 */
export const DEFAULT_SCORING_CONFIG: Required<
  Pick<ScoringGateConfig, 'blockThreshold' | 'warnThreshold' | 'failOpen' | 'verbose'>
> & {
  cache: Required<ScoringCacheConfig>;
} = {
  blockThreshold: 70,
  warnThreshold: 40,
  failOpen: true,
  verbose: false,
  cache: {
    enabled: true,
    ttlMs: 300000, // 5 minutes
    maxEntries: 1000,
  },
};

/**
 * Normalized internal configuration used by ScoringGate
 * This is the result of normalizing ScoringGateConfig
 */
export interface NormalizedScoringConfig {
  /**
   * The effective scorer type
   */
  scorerType: ScorerType;

  /**
   * Progressive config if using progressive strategy
   */
  progressiveConfig?: ProgressiveScoringConfig;

  /**
   * Block threshold
   */
  blockThreshold: number;

  /**
   * Warn threshold
   */
  warnThreshold: number;

  /**
   * Fail-open behavior
   */
  failOpen: boolean;

  /**
   * Verbose logging
   */
  verbose: boolean;

  /**
   * Cache configuration
   */
  cache: Required<ScoringCacheConfig>;

  /**
   * Local LLM configuration (from direct config or progressive)
   */
  localLlm?: LocalLlmConfig;

  /**
   * External API configuration (from direct config or progressive)
   */
  externalApi?: ExternalApiConfig;

  /**
   * Custom rules for rule-based scorer
   */
  customRules?: Record<string, number>;
}

/**
 * Normalize a ScoringGateConfig to NormalizedScoringConfig
 *
 * Handles both legacy single-scorer mode and new progressive mode,
 * producing a consistent internal representation.
 *
 * @param config - User-provided configuration
 * @returns Normalized configuration for internal use
 */
export function normalizeScoringConfig(config: ScoringGateConfig): NormalizedScoringConfig {
  // Determine scorer type: progressive config takes precedence
  let scorerType: ScorerType;
  let progressiveConfig: ProgressiveScoringConfig | undefined;
  let localLlm = config.localLlm;
  let externalApi = config.externalApi;
  let customRules = config.customRules;

  if (config.scoring) {
    // New progressive mode
    scorerType = 'progressive';
    progressiveConfig = config.scoring;

    // Extract nested configs from progressive
    if (progressiveConfig.detailed.localLlm) {
      localLlm = progressiveConfig.detailed.localLlm;
    }
    if (progressiveConfig.detailed.externalApi) {
      externalApi = progressiveConfig.detailed.externalApi;
    }
    if (progressiveConfig.fast.customRules) {
      customRules = { ...customRules, ...progressiveConfig.fast.customRules };
    }
  } else {
    // Legacy single-scorer mode
    scorerType = config.scorer ?? 'disabled';
  }

  return {
    scorerType,
    progressiveConfig,
    blockThreshold: config.blockThreshold ?? DEFAULT_SCORING_CONFIG.blockThreshold,
    warnThreshold: config.warnThreshold ?? DEFAULT_SCORING_CONFIG.warnThreshold,
    failOpen: config.failOpen ?? DEFAULT_SCORING_CONFIG.failOpen,
    verbose: config.verbose ?? DEFAULT_SCORING_CONFIG.verbose,
    cache: {
      enabled: config.cache?.enabled ?? DEFAULT_SCORING_CONFIG.cache.enabled,
      ttlMs: config.cache?.ttlMs ?? DEFAULT_SCORING_CONFIG.cache.ttlMs,
      maxEntries: config.cache?.maxEntries ?? DEFAULT_SCORING_CONFIG.cache.maxEntries,
    },
    localLlm,
    externalApi,
    customRules,
  };
}

/**
 * Thresholds for various detection rules
 */
export const RULE_THRESHOLDS = {
  /**
   * Limit value considered excessive
   */
  EXCESSIVE_LIMIT: 10000,

  /**
   * Numeric value considered extreme
   */
  EXTREME_VALUE: 1000000,

  /**
   * Minimum tool calls to consider high density
   */
  HIGH_DENSITY_CALLS: 5,

  /**
   * Fan-out risk threshold
   */
  HIGH_FAN_OUT: 3,
} as const;
