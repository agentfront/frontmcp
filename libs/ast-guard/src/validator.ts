import * as acorn from 'acorn';
import {
  ValidationRule,
  ValidationConfig,
  ValidationResult,
  ValidationContext,
  ValidationIssue,
  ValidationSeverity,
  ValidationStats,
} from './interfaces';
import { ParseError, InvalidSourceError, ConfigurationError } from './errors';

/**
 * Main AST validator class
 */
export class JSAstValidator {
  private rules: Map<string, ValidationRule> = new Map();

  constructor(rules?: ValidationRule[]) {
    if (rules) {
      for (const rule of rules) {
        this.registerRule(rule);
      }
    }
  }

  /**
   * Register a validation rule
   */
  registerRule(rule: ValidationRule): void {
    if (this.rules.has(rule.name)) {
      throw new ConfigurationError(`Rule ${rule.name} is already registered`);
    }
    this.rules.set(rule.name, rule);
  }

  /**
   * Unregister a validation rule
   */
  unregisterRule(ruleName: string): boolean {
    return this.rules.delete(ruleName);
  }

  /**
   * Get all registered rules
   */
  getRules(): ValidationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule by name
   */
  getRule(ruleName: string): ValidationRule | undefined {
    return this.rules.get(ruleName);
  }

  /**
   * Validate JavaScript source code
   */
  async validate(source: string, config: ValidationConfig = {}): Promise<ValidationResult> {
    const startTime = Date.now();

    // Validate input
    if (typeof source !== 'string') {
      throw new InvalidSourceError('Source must be a string');
    }

    if (source.trim().length === 0) {
      throw new InvalidSourceError('Source cannot be empty');
    }

    const issues: ValidationIssue[] = [];
    let ast: acorn.Node | undefined;
    let parseError: Error | undefined;

    // Parse the source code
    try {
      const parseOptions: acorn.Options = {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true,
        ...config.parseOptions,
      };

      ast = acorn.parse(source, parseOptions) as unknown as acorn.Node;
    } catch (err: unknown) {
      const error = err as Error & { loc?: { line: number; column: number } };
      parseError = new ParseError(error.message || 'Failed to parse source code', error.loc?.line, error.loc?.column);

      issues.push({
        code: 'PARSE_ERROR',
        severity: ValidationSeverity.ERROR,
        message: parseError.message,
        location: error.loc ? { line: error.loc.line, column: error.loc.column } : undefined,
      });

      return {
        valid: false,
        issues,
        parseError,
        rulesExecuted: 0,
      };
    }

    // Get enabled rules
    const enabledRules = this.getEnabledRules(config);

    // Execute rules
    try {
      for (const rule of enabledRules) {
        // Get rule configuration for severity override
        const ruleConfig = config.rules?.[rule.name];
        const configSeverity = typeof ruleConfig === 'object' ? ruleConfig.severity : undefined;

        // Create per-rule validation context with proper severity resolution
        const context: ValidationContext = {
          ast,
          source,
          config,
          visited: new Set(),
          metadata: new Map(),
          report: (issue) => {
            // Precedence: issue.severity → ruleConfig.severity → rule.defaultSeverity → ERROR fallback
            const severity = issue.severity ?? configSeverity ?? rule.defaultSeverity ?? ValidationSeverity.ERROR;

            const fullIssue: ValidationIssue = {
              ...issue,
              severity,
            };

            issues.push(fullIssue);

            // Stop on first error if configured
            if (config.stopOnFirstError && fullIssue.severity === ValidationSeverity.ERROR) {
              throw new StopValidationError();
            }

            // Stop if max issues reached
            if (config.maxIssues && config.maxIssues > 0 && issues.length >= config.maxIssues) {
              throw new StopValidationError();
            }
          },
        };

        await rule.validate(context);
      }
    } catch (err) {
      if (!(err instanceof StopValidationError)) {
        throw err;
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      valid: !issues.some((issue) => issue.severity === ValidationSeverity.ERROR),
      issues,
      ast,
      rulesExecuted: enabledRules.length,
    };
  }

  /**
   * Get validation statistics from a result
   */
  getStats(result: ValidationResult, durationMs: number): ValidationStats {
    const stats = {
      totalIssues: result.issues.length,
      errors: 0,
      warnings: 0,
      infos: 0,
      rulesExecuted: result.rulesExecuted ?? 0,
      durationMs,
    };

    for (const issue of result.issues) {
      switch (issue.severity) {
        case ValidationSeverity.ERROR:
          stats.errors++;
          break;
        case ValidationSeverity.WARNING:
          stats.warnings++;
          break;
        case ValidationSeverity.INFO:
          stats.infos++;
          break;
      }
    }

    return stats;
  }

  /**
   * Get enabled rules based on configuration
   */
  private getEnabledRules(config: ValidationConfig): ValidationRule[] {
    const enabled: ValidationRule[] = [];

    for (const rule of this.rules.values()) {
      const ruleConfig = config.rules?.[rule.name];

      // If rule is not configured, use its default enabled state
      if (ruleConfig === undefined) {
        if (rule.enabledByDefault) {
          enabled.push(rule);
        }
        continue;
      }

      // If rule config is boolean
      if (typeof ruleConfig === 'boolean') {
        if (ruleConfig) {
          enabled.push(rule);
        }
        continue;
      }

      // If rule config is object
      // noinspection SuspiciousTypeOfGuard
      const explicitlyEnabled = typeof ruleConfig.enabled === 'boolean' ? ruleConfig.enabled : undefined;
      const shouldEnable = explicitlyEnabled ?? rule.enabledByDefault;
      if (shouldEnable) {
        enabled.push(rule);
      }
    }

    return enabled;
  }
}

/**
 * Internal error to stop validation early
 */
class StopValidationError extends Error {
  constructor() {
    super('Validation stopped');
    this.name = 'StopValidationError';
  }
}
