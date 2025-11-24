// file: libs/plugins/src/codecall/providers/codecall-ast-validator.provider.ts

import { createPreset, JSAstValidator, PresetLevel, ValidationSeverity } from 'ast-guard';

import { CodeCallAstValidationIssue, CodeCallAstValidationResult, CodeCallAstValidator } from '../codecall.symbol';
import { Provider, ProviderScope } from '@frontmcp/sdk';
import type CodeCallConfig from './code-call.config';

/**
 * Maps CodeCall VM presets to ast-guard preset levels
 */
const PRESET_MAPPING: Record<string, PresetLevel> = {
  locked_down: PresetLevel.STRICT,
  secure: PresetLevel.SECURE,
  balanced: PresetLevel.STANDARD,
  experimental: PresetLevel.PERMISSIVE,
};

/**
 * AST validator for CodeCall JavaScript plans using ast-guard
 * Uses dependency injection to get CodeCallConfig
 */
@Provider({
  name: 'codecall:ast-validator',
  description: 'Validates JS scripts before they hit the VM',
  scope: ProviderScope.GLOBAL,
})
export default class AstValidateService implements CodeCallAstValidator {
  private readonly validator: JSAstValidator;

  constructor(config: CodeCallConfig) {
    // Get resolved VM options from config
    const vmOptions = config.get('resolvedVm');
    const presetLevel = PRESET_MAPPING[vmOptions.preset] || PresetLevel.SECURE;

    // Combine all disallowed identifiers (including console if needed)
    // Deduplicate to keep the rule set minimal in case of overlaps
    const additionalDisallowed = [
      ...new Set([
        ...vmOptions.disabledBuiltins,
        ...vmOptions.disabledGlobals,
        ...(vmOptions.allowConsole ? [] : ['console']),
      ]),
    ];

    // Create rules based on VM options
    const loopConfig = vmOptions.allowLoops
      ? {
          allowFor: true,
          allowWhile: true,
          allowDoWhile: true,
          allowForIn: true,
          allowForOf: true,
        }
      : {
          allowFor: false,
          allowWhile: false,
          allowDoWhile: false,
          allowForIn: false,
          allowForOf: false,
        };

    const presetOptions: any = {
      // Add additional disallowed identifiers from VM options
      additionalDisallowedIdentifiers: additionalDisallowed,

      // Configure loops based on allowLoops flag
      allowedLoops: loopConfig,

      // Don't require callTool - scripts may be used for data transformation only
      // requiredFunctions: ['callTool'],
      // minFunctionCalls: 0,
    };

    const rules = createPreset(presetLevel, presetOptions);

    this.validator = new JSAstValidator(rules);
  }

  /**
   * Validate a JS script before it hits the VM.
   * Should catch syntax errors + illegal identifiers/loops.
   */
  async validate(script: string): Promise<CodeCallAstValidationResult> {
    // Validate using script mode with allowReturnOutsideFunction
    // This matches the isolated-vm execution environment which wraps scripts in async IIFEs
    // We use 'script' mode to support top-level return and await (via allowAwaitOutsideFunction if needed)
    const result = await this.validator.validate(script, {
      parseOptions: {
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
      },
      // Explicitly enable rules - ast-guard requires rules to be explicitly enabled
      // unless they have enabledByDefault: true (most security rules have enabledByDefault: false)
      rules: {
        'disallowed-identifier': true,
        'no-eval': true,
        'no-async': true,
        'forbidden-loop': true,
        'required-function-call': true,
        'call-argument-validation': true,
      },
    });

    // Map ast-guard validation issues to CodeCall format (only ERROR-level)
    const issues: CodeCallAstValidationIssue[] = result.issues
      .filter((issue) => issue.severity === ValidationSeverity.ERROR)
      .map((issue) => {
        // Extract identifier from message or data for better kind mapping
        const identifier = (issue.data?.['identifier'] as string) || this.extractIdentifierFromMessage(issue.message);

        return {
          kind: this.mapCodeToKind(issue.code, identifier),
          message: issue.message,
          location: issue.location
            ? {
                line: issue.location.line,
                column: issue.location.column,
              }
            : undefined,
          identifier,
        };
      });

    // Derive 'ok' from the filtered issues to ensure consistency
    // (script is valid only if there are no ERROR-level issues)
    const ok = issues.length === 0;

    return {
      ok,
      issues,
    };
  }

  /**
   * Extract identifier from error message
   */
  private extractIdentifierFromMessage(message: string): string | undefined {
    // Try to extract identifier from messages like "Identifier 'Function' is not allowed"
    let match = message.match(/Identifier\s+'([^']+)'/);
    if (match) return match[1];

    // Try to extract from messages like 'Access to "Function" is not allowed'
    match = message.match(/Access to "([^"]+)"/);
    if (match) return match[1];

    // Try to extract from messages like 'Use of Function constructor'
    match = message.match(/Use of (\w+) constructor/);
    if (match) return match[1];

    // Try to extract from messages like 'Use of eval() is not allowed'
    match = message.match(/Use of (\w+)\(\)/);
    if (match) return match[1];

    return undefined;
  }

  /**
   * Maps ast-guard issue codes to CodeCall issue kinds
   */
  private mapCodeToKind(code: string, identifier?: string): CodeCallAstValidationIssue['kind'] {
    switch (code) {
      case 'parse-error':
      case 'PARSE_ERROR':
        return 'ParseError';
      case 'disallowed-identifier':
      case 'DISALLOWED_IDENTIFIER':
        // Check if this is eval - it should be IllegalBuiltinAccess
        if (identifier === 'eval') {
          return 'IllegalBuiltinAccess';
        }
        return 'DisallowedGlobal';
      case 'forbidden-loop':
      case 'FORBIDDEN_LOOP':
        return 'DisallowedLoop';
      case 'no-eval':
      case 'NO_EVAL':
        // Only eval itself is IllegalBuiltinAccess
        // Function constructor and others are DisallowedGlobal
        if (identifier === 'eval') {
          return 'IllegalBuiltinAccess';
        }
        return 'DisallowedGlobal';
      case 'no-async':
      case 'NO_ASYNC':
        // Async-related violations are DisallowedGlobal unless it's eval
        if (identifier === 'eval') {
          return 'IllegalBuiltinAccess';
        }
        return 'DisallowedGlobal';
      default:
        return 'IllegalBuiltinAccess';
    }
  }
}
