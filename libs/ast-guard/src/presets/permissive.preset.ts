import { ValidationRule } from '../interfaces';
import {
  NoEvalRule,
  UnreachableCodeRule,
  RequiredFunctionCallRule,
  CallArgumentValidationRule,
  DisallowedIdentifierRule,
} from '../rules';
import { PresetOptions } from './types';

/**
 * Creates a PERMISSIVE preset with minimal restrictions
 *
 * Blocks:
 * - eval() only (for basic safety)
 *
 * Allows:
 * - All loops
 * - Async/await
 * - Most identifiers
 * - Constructor and prototype access
 *
 * Only detects:
 * - Unreachable code (as warning)
 *
 * @param options - Optional customization for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * // Minimal security for internal scripts
 * const rules = createPermissivePreset();
 *
 * // Permissive but still enforce API calls
 * const rules = createPermissivePreset({
 *   requiredFunctions: ['callTool']
 * });
 *
 * // Permissive but block specific identifiers
 * const rules = createPermissivePreset({
 *   additionalDisallowedIdentifiers: ['dangerousFunction']
 * });
 * ```
 */
export function createPermissivePreset(options: PresetOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Only block eval() for basic safety
  rules.push(new NoEvalRule());

  // Add disallowed identifier rule ONLY if additional identifiers are specified
  if (options.additionalDisallowedIdentifiers && options.additionalDisallowedIdentifiers.length > 0) {
    rules.push(
      new DisallowedIdentifierRule({
        disallowed: options.additionalDisallowedIdentifiers,
      }),
    );
  }

  // Allow all loops (ForbiddenLoopRule not added)

  // Allow async/await (NoAsyncRule not added)

  // Detect unreachable code (warning only)
  rules.push(new UnreachableCodeRule());

  // Enforce required function calls if specified
  if (options.requiredFunctions && options.requiredFunctions.length > 0) {
    rules.push(
      new RequiredFunctionCallRule({
        required: options.requiredFunctions,
        minCalls: options.minFunctionCalls ?? 1,
        maxCalls: options.maxFunctionCalls,
      }),
    );
  }

  // Enforce argument validation if specified
  if (options.functionArgumentRules && Object.keys(options.functionArgumentRules).length > 0) {
    rules.push(
      new CallArgumentValidationRule({
        functions: options.functionArgumentRules,
      }),
    );
  }

  return rules;
}
