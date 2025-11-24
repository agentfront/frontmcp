import { ValidationRule } from '../interfaces';
import {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  RequiredFunctionCallRule,
  UnreachableCodeRule,
  CallArgumentValidationRule,
  NoEvalRule,
  NoAsyncRule,
} from '../rules';
import { PresetOptions } from './types';

/**
 * Creates a STANDARD preset with sensible defaults for most use cases
 *
 * Blocks:
 * - eval() and Function constructor
 * - Critical dangerous identifiers (process, require)
 * - Infinite while/do-while loops
 *
 * Allows:
 * - All loop types except while/do-while
 * - Async/await
 * - Constructor and prototype access (with caution)
 *
 * @param options - Optional customization for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * // Standard security
 * const rules = createStandardPreset();
 *
 * // Standard with API enforcement
 * const rules = createStandardPreset({
 *   requiredFunctions: ['callTool'],
 *   functionArgumentRules: {
 *     callTool: { minArgs: 2 }
 *   }
 * });
 *
 * // Standard but also block window/document
 * const rules = createStandardPreset({
 *   additionalDisallowedIdentifiers: ['window', 'document']
 * });
 * ```
 */
export function createStandardPreset(options: PresetOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Block eval-like constructs
  rules.push(new NoEvalRule());

  // Block critical dangerous identifiers only
  const disallowedIdentifiers = [
    'eval',
    'Function',
    'process',
    'require',
    ...(options.additionalDisallowedIdentifiers || []),
  ];
  rules.push(new DisallowedIdentifierRule({ disallowed: disallowedIdentifiers }));

  // Allow all loops except while/do-while (can be overridden)
  rules.push(
    new ForbiddenLoopRule({
      allowFor: options.allowedLoops?.allowFor ?? true,
      allowWhile: options.allowedLoops?.allowWhile ?? false,
      allowDoWhile: options.allowedLoops?.allowDoWhile ?? false,
      allowForIn: options.allowedLoops?.allowForIn ?? true,
      allowForOf: options.allowedLoops?.allowForOf ?? true,
    }),
  );

  // Allow async/await (can be overridden)
  rules.push(
    new NoAsyncRule({
      allowAsyncFunctions: options.allowAsync?.allowAsyncFunctions ?? true,
      allowAwait: options.allowAsync?.allowAwait ?? true,
    }),
  );

  // Detect unreachable code
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
