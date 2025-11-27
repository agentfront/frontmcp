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
 */
export type ScorerType = 'disabled' | 'rule-based' | 'local-llm' | 'external-api';

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
 * Configuration for local LLM scorer
 */
export interface LocalLlmConfig {
  /**
   * Model identifier
   * @example 'qwen2.5-coder-0.5b'
   */
  modelId: 'qwen2.5-coder-0.5b' | 'phi-3-mini' | 'llama-3.2-1b' | string;

  /**
   * Model quantization level
   * - int4: Smallest size, fastest, slightly lower quality
   * - int8: Medium size and speed
   * - fp16: Best quality, largest size
   */
  quantization: 'int4' | 'int8' | 'fp16';

  /**
   * Maximum tokens for generation
   * @default 256
   */
  maxTokens?: number;

  /**
   * Model download directory (defaults to ~/.frontmcp/models)
   */
  modelDir?: string;
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
 */
export interface ScoringGateConfig {
  /**
   * Scorer mode to use
   * @default 'disabled'
   */
  scorer: ScorerType;

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
