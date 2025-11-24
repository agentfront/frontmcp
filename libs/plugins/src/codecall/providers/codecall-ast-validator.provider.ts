// file: libs/plugins/src/codecall/providers/codecall-ast-validator.provider.ts

import { JSAstValidator, ValidationRule, createPreset, PresetLevel, ValidationSeverity } from 'ast-guard';

import {
  CodeCallAstValidator,
  CodeCallAstValidationIssue,
  CodeCallAstValidationResult,
  ResolvedCodeCallVmOptions,
} from '../codecall.symbol';

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
 * Provided dynamically by the plugin to inject VM options
 */
export default class CodeCallAstValidatorProvider implements CodeCallAstValidator {
  private readonly validator: JSAstValidator;

  constructor(private readonly vmOptions: ResolvedCodeCallVmOptions) {
    const presetLevel = PRESET_MAPPING[vmOptions.preset] || PresetLevel.SECURE;

    // Create rules based on VM options
    const rules = createPreset(presetLevel, {
      // Add additional disallowed identifiers from VM options
      additionalDisallowedIdentifiers: [...vmOptions.disabledBuiltins, ...vmOptions.disabledGlobals],

      // Configure loops based on allowLoops flag
      allowedLoops: vmOptions.allowLoops
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
          },

      // Don't require callTool - scripts may be used for data transformation only
      // requiredFunctions: ['callTool'],
      // minFunctionCalls: 0,

      // Allow console if enabled in VM options
      ...(vmOptions.allowConsole ? {} : { additionalDisallowedIdentifiers: ['console'] }),
    });

    this.validator = new JSAstValidator(rules);
  }

  async validate(script: string): Promise<CodeCallAstValidationResult> {
    const result = await this.validator.validate(script);

    // Map ast-guard validation issues to CodeCall format
    const issues: CodeCallAstValidationIssue[] = result.issues
      .filter((issue) => issue.severity === ValidationSeverity.ERROR)
      .map((issue) => ({
        kind: this.mapCodeToKind(issue.code),
        message: issue.message,
        location: issue.location
          ? {
              line: issue.location.line,
              column: issue.location.column,
            }
          : undefined,
        identifier: (issue.data?.['identifier'] as string) || undefined,
      }));

    return {
      ok: result.valid,
      issues,
    };
  }

  /**
   * Maps ast-guard issue codes to CodeCall issue kinds
   */
  private mapCodeToKind(code: string): CodeCallAstValidationIssue['kind'] {
    switch (code) {
      case 'parse-error':
        return 'ParseError';
      case 'disallowed-identifier':
        return 'DisallowedGlobal';
      case 'forbidden-loop':
        return 'DisallowedLoop';
      case 'no-eval':
      case 'no-async':
        return 'IllegalBuiltinAccess';
      default:
        return 'IllegalBuiltinAccess';
    }
  }
}
