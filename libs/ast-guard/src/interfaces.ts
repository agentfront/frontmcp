import type * as acorn from 'acorn';

/**
 * Severity levels for validation issues
 */
export enum ValidationSeverity {
  /** Error that must be fixed */
  ERROR = 'error',
  /** Warning that should be reviewed */
  WARNING = 'warning',
  /** Informational message */
  INFO = 'info',
}

/**
 * Location information for validation issues
 */
export interface SourceLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * A validation issue found during AST analysis
 */
export interface ValidationIssue {
  /** Unique code for this type of issue */
  code: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Human-readable message */
  message: string;
  /** Source location */
  location?: SourceLocation;
  /** Additional context data */
  data?: Record<string, unknown>;
}

/**
 * Context provided to validation rules
 */
export interface ValidationContext {
  /** The parsed AST */
  ast: acorn.Node;
  /** Original source code */
  source: string;
  /** Validation configuration */
  config: ValidationConfig;
  /** Report a validation issue */
  report(issue: Omit<ValidationIssue, 'severity'> & { severity?: ValidationSeverity }): void;
  /** Track visited nodes (for cycle detection) */
  visited: Set<acorn.Node>;
  /** Custom context data that rules can use */
  metadata: Map<string, unknown>;
}

/**
 * A validation rule that can be applied to AST
 */
export interface ValidationRule {
  /** Unique identifier for this rule */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Default severity level */
  readonly defaultSeverity: ValidationSeverity;
  /** Whether this rule is enabled by default */
  readonly enabledByDefault: boolean;

  /**
   * Validate the AST and report issues
   * @param context Validation context
   */
  validate(context: ValidationContext): void | Promise<void>;
}

/**
 * Configuration for a specific rule
 */
export interface RuleConfig {
  /** Whether the rule is enabled */
  enabled: boolean;
  /** Override default severity */
  severity?: ValidationSeverity;
  /** Rule-specific options */
  options?: Record<string, unknown>;
}

/**
 * Transformation mode
 */
export type TransformMode = 'blacklist' | 'whitelist';

/**
 * Configuration for whitelisted standard library globals
 * Specifies which methods of standard objects are allowed
 */
export interface WhitelistedGlobals {
  /** Allowed Math methods (e.g., ['max', 'min', 'floor', 'ceil']) */
  Math?: string[];
  /** Allowed JSON methods (e.g., ['parse', 'stringify']) */
  JSON?: string[];
  /** Allowed Array prototype methods (e.g., ['map', 'filter', 'reduce']) */
  Array?: string[];
  /** Allowed Object methods (e.g., ['keys', 'values', 'entries']) */
  Object?: string[];
  /** Allowed String prototype methods (e.g., ['startsWith', 'includes']) */
  String?: string[];
  /** Allowed Date methods (e.g., ['now']) */
  Date?: string[];
  /** Allowed Number methods (e.g., ['parseInt', 'parseFloat']) */
  Number?: string[];
}

/**
 * Configuration for code transformation
 */
export interface TransformConfig {
  /** Whether transformation is enabled */
  enabled: boolean;

  /** Prefix to add to identifiers (default: '__safe_') */
  prefix?: string;

  /**
   * Transformation mode:
   * - 'blacklist': Only transform identifiers in the `identifiers` list (default)
   * - 'whitelist': Transform ALL identifiers EXCEPT those in `whitelistedIdentifiers` list
   */
  mode?: TransformMode;

  /**
   * BLACKLIST MODE: List of identifier names to transform
   * Used when mode is 'blacklist' (default)
   */
  identifiers?: string[];

  /**
   * WHITELIST MODE: List of identifier names NOT to transform
   * Used when mode is 'whitelist'
   * Example: ['undefined', 'null', 'true', 'false', 'Math', 'JSON']
   */
  whitelistedIdentifiers?: string[];

  /**
   * WHITELIST MODE: Whitelisted standard library globals and their methods
   * Used when mode is 'whitelist'
   */
  whitelistedGlobals?: WhitelistedGlobals;

  /** Whether to transform computed member expressions (e.g., obj['eval']) */
  transformComputed?: boolean;

  /** Whether to transform loops into safe function calls */
  transformLoops?: boolean;
}

/**
 * Configuration for the pre-scanner (Layer 0)
 */
export interface PreScanConfig {
  /**
   * Whether pre-scanning is enabled.
   * Default: true (pre-scanner runs before AST parsing)
   */
  enabled?: boolean;

  /**
   * Preset level for pre-scanner configuration.
   * Options: 'agentscript' | 'strict' | 'secure' | 'standard' | 'permissive'
   * Default: 'standard'
   */
  preset?: 'agentscript' | 'strict' | 'secure' | 'standard' | 'permissive';

  /**
   * Custom configuration overrides (merged with preset).
   * See PreScannerConfig for available options.
   */
  config?: Record<string, unknown>;
}

/**
 * Configuration for the validator
 */
export interface ValidationConfig {
  /** Parse options for acorn */
  parseOptions?: acorn.Options;
  /** Rule configurations */
  rules?: Record<string, RuleConfig | boolean>;
  /** Maximum number of issues before stopping (0 = unlimited) */
  maxIssues?: number;
  /** Stop on first error */
  stopOnFirstError?: boolean;
  /** Transformation configuration */
  transform?: TransformConfig;
  /**
   * Pre-scanner configuration (Layer 0 defense).
   * Runs BEFORE AST parsing to catch attacks that could DOS the parser.
   * Default: enabled with 'standard' preset
   */
  preScan?: PreScanConfig;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  /** Whether validation passed (no errors) */
  valid: boolean;
  /** All issues found */
  issues: ValidationIssue[];
  /** The parsed AST (if parsing succeeded) */
  ast?: acorn.Node;
  /** Parse error if parsing failed */
  parseError?: Error;
  /** Number of rules that were executed during validation */
  rulesExecuted?: number;
  /** Transformed code (if transformation is enabled) */
  transformedCode?: string;
  /** Pre-scanner error if pre-scan failed */
  preScanError?: Error;
  /**
   * Pre-scanner statistics (if pre-scan was run).
   * Note: This is an intentional subset exposing only essential metrics.
   * Internal stats like unicodeIssueCount are excluded from public API.
   */
  preScanStats?: {
    inputSize: number;
    lineCount: number;
    maxNestingDepthFound: number;
    regexCount: number;
    scanDurationMs: number;
  };
}

/**
 * Statistics about validation
 */
export interface ValidationStats {
  /** Total number of issues */
  totalIssues: number;
  /** Number of errors */
  errors: number;
  /** Number of warnings */
  warnings: number;
  /** Number of info messages */
  infos: number;
  /** Number of rules executed */
  rulesExecuted: number;
  /** Validation duration in milliseconds */
  durationMs: number;
}
