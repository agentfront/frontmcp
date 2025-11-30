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
 * - eval() and Function constructors (Arbitrary Code Execution)
 * - System globals (process, require, module)
 * - Prototype pollution vectors (__proto__)
 *
 * Allows:
 * - All loops
 * - Async/await
 * - Most identifiers
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
 * requiredFunctions: ['callTool']
 * });
 * ```
 */
export function createPermissivePreset(options: PresetOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // 1. Block eval()
  rules.push(new NoEvalRule());

  // 2. Establish Baseline Security (CRITICAL FIX)
  // Even a permissive preset must block identifiers that allow:
  // - Sandbox escapes (Function, constructor)
  // - System access (process, require)
  // - Prototype poisoning (__proto__)
  const baselineDangerous = [
    // Execution Primitives (Bypasses NoEvalRule)
    'Function',
    'AsyncFunction',
    'GeneratorFunction',

    // System Access
    'process',
    'require',
    'module',
    'exports',

    // Prototype Poisoning
    '__proto__',
    // We explicitly do NOT block 'constructor' here in permissive mode
    // as it breaks many legitimate patterns, but we MUST block __proto__
  ];

  // Merge baseline with user-provided identifiers
  const allDisallowed = [...baselineDangerous, ...(options.additionalDisallowedIdentifiers || [])];

  // Always add the rule with the combined list
  rules.push(
    new DisallowedIdentifierRule({
      disallowed: allDisallowed,
    }),
  );

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
