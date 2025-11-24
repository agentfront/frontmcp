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
    const additionalDisallowed = [
      ...vmOptions.disabledBuiltins,
      ...vmOptions.disabledGlobals,
      ...(vmOptions.allowConsole ? [] : ['console']),
    ];

    // Create rules based on VM options
    const rules = createPreset(presetLevel, {
      // Add additional disallowed identifiers from VM options
      additionalDisallowedIdentifiers: additionalDisallowed,

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
    });

    this.validator = new JSAstValidator(rules);
  }

  /**
   * Validate a JS script before it hits the VM.
   * Should catch syntax errors + illegal identifiers/loops.
   */
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
