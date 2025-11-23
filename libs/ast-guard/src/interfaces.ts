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
