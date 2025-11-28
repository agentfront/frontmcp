import { ValidationRule } from '../interfaces';
import {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  RequiredFunctionCallRule,
  UnreachableCodeRule,
  CallArgumentValidationRule,
  NoEvalRule,
  NoAsyncRule,
  NoRegexLiteralRule,
  NoRegexMethodsRule,
} from '../rules';
import { PresetOptions } from './types';

/**
 * Creates a SECURE preset with high security but some flexibility
 *
 * Blocks:
 * - All eval-like constructs
 * - Most dangerous identifiers
 * - Infinite loops (allows bounded loops)
 * - Async functions (allows await if needed)
 *
 * Allows:
 * - For/for-of loops with bounds
 * - Await expressions (but not async function declarations)
 *
 * @param options - Optional customization for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * // High security with flexibility
 * const rules = createSecurePreset();
 *
 * // Secure with required API calls
 * const rules = createSecurePreset({
 *   requiredFunctions: ['callTool'],
 *   minFunctionCalls: 1,
 *   maxFunctionCalls: 10
 * });
 *
 * // Secure but also allow while loops
 * const rules = createSecurePreset({
 *   allowedLoops: { allowWhile: true }
 * });
 * ```
 */
export function createSecurePreset(options: PresetOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Block eval-like constructs
  rules.push(new NoEvalRule());

  // Block dangerous identifiers (less restrictive than lockdown but still secure)
  const disallowedIdentifiers = [
    // Code execution
    'eval',
    'Function',
    'AsyncFunction',
    'GeneratorFunction',

    // Node.js/System access
    'process',
    'require',
    'global',
    'globalThis',
    '__dirname',
    '__filename',
    'module',
    'exports',

    // Prototype manipulation (critical)
    '__proto__',
    'prototype',

    // Reflection and metaprogramming (high risk)
    'Proxy',
    'Reflect',

    // WebAssembly (native code execution)
    'WebAssembly',

    // Workers (sandbox escape)
    'Worker',
    'SharedWorker',
    'ServiceWorker',

    // Binary data (memory manipulation)
    'SharedArrayBuffer',
    'Atomics',

    // Browser APIs (if applicable)
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'indexedDB',

    // Import/dynamic loading
    // Note: The 'import' keyword causes parse errors in script mode (default),
    // so it's redundant here but kept for completeness. Only 'import()' (dynamic import)
    // would parse in script mode, and it appears as a CallExpression, not an identifier.
    'import',
    'importScripts',

    ...(options.additionalDisallowedIdentifiers || []),
  ];
  rules.push(new DisallowedIdentifierRule({ disallowed: disallowedIdentifiers }));

  // Allow for and for-of loops, block while/do-while (can be overridden)
  rules.push(
    new ForbiddenLoopRule({
      allowFor: options.allowedLoops?.allowFor ?? true,
      allowWhile: options.allowedLoops?.allowWhile ?? false,
      allowDoWhile: options.allowedLoops?.allowDoWhile ?? false,
      allowForIn: options.allowedLoops?.allowForIn ?? false,
      allowForOf: options.allowedLoops?.allowForOf ?? true,
    }),
  );

  // Block async functions but allow await (can be overridden)
  rules.push(
    new NoAsyncRule({
      allowAsyncFunctions: options.allowAsync?.allowAsyncFunctions ?? false,
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

  // Analyze regex literals for ReDoS vulnerabilities
  rules.push(
    new NoRegexLiteralRule({
      blockAll: false,
      analyzePatterns: true,
      analysisLevel: 'catastrophic',
      maxPatternLength: 200, // More lenient than strict
    }),
  );

  // Block regex methods with dynamic arguments, allow string arguments
  rules.push(
    new NoRegexMethodsRule({
      allowStringArguments: true, // Allow safe string arguments like str.split(",")
    }),
  );

  return rules;
}
