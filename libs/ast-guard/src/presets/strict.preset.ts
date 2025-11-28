import { ValidationRule } from '../interfaces';
import {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  RequiredFunctionCallRule,
  UnreachableCodeRule,
  CallArgumentValidationRule,
  NoEvalRule,
  NoAsyncRule,
  NoGlobalAccessRule,
  NoRegexLiteralRule,
  NoRegexMethodsRule,
} from '../rules';
import { PresetOptions } from './types';

/**
 * Creates a STRICT preset with maximum security restrictions (bank-grade)
 *
 * Blocks:
 * - All eval-like constructs (eval, Function constructor)
 * - All loops (configurable via options)
 * - All async/await (configurable via options)
 * - Dangerous identifiers (eval, Function, process, require, etc.)
 * - Constructor chain access (.constructor property)
 * - Prototype manipulation (__proto__, Object.setPrototypeOf)
 * - Global object access (window, globalThis, this, global)
 * - Reflection APIs (Reflect.*)
 * - Meta-programming APIs (Object.getOwnPropertyDescriptor, etc.)
 *
 * Enforces:
 * - Required function calls (if specified)
 * - Strict argument validation (if specified)
 * - Unreachable code detection
 *
 * Protection against:
 * - ✅ All vm2 CVEs (2023-29017, 2023-30547, 2023-32313, 2023-37466)
 * - ✅ isolated-vm escape vectors
 * - ✅ node-vm sandbox escapes
 * - ✅ Constructor chain exploits
 * - ✅ Prototype pollution attacks
 *
 * @param options - Optional customization for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * // Maximum security (bank-grade)
 * const rules = createStrictPreset();
 *
 * // Strict with required API calls
 * const rules = createStrictPreset({
 *   requiredFunctions: ['callTool'],
 *   functionArgumentRules: {
 *     callTool: { minArgs: 2, expectedTypes: ['string', 'object'] }
 *   }
 * });
 *
 * // Strict but allow for loops
 * const rules = createStrictPreset({
 *   allowedLoops: { allowFor: true, allowForOf: true }
 * });
 * ```
 */
export function createStrictPreset(options: PresetOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Block all eval-like constructs
  rules.push(new NoEvalRule());

  // Block global object access patterns (constructor chains, reflection APIs, etc.)
  rules.push(
    new NoGlobalAccessRule({
      blockedGlobals: ['window', 'globalThis', 'self', 'global', 'this'],
      blockMemberAccess: true,
      blockComputedAccess: true,
    }),
  );

  // Block all dangerous identifiers for bank-level security
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
    'Buffer',
    'arguments',
    'callee',
    'caller',

    // Prototype manipulation
    'constructor',
    '__proto__',
    'prototype',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'BigInt',

    // Error manipulation (stack traces can leak execution context)
    'Error',
    'TypeError',
    'ReferenceError',
    'SyntaxError',
    'RangeError',
    'URIError',
    'EvalError',
    'AggregateError',

    // Reflection and metaprogramming
    'Proxy',
    'Reflect',

    // Async primitives (timing attacks, race conditions)
    'Promise',

    // Pattern matching (ReDoS attacks)
    'RegExp',

    // Binary data (memory manipulation)
    'ArrayBuffer',
    'SharedArrayBuffer',
    'DataView',
    'Uint8Array',
    'Uint16Array',
    'Uint32Array',
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',

    // WebAssembly (native code execution)
    'WebAssembly',

    // Workers (sandbox escape)
    'Worker',
    'SharedWorker',
    'ServiceWorker',

    // Internationalization (can leak system info)
    'Intl',

    // Atomics (SharedArrayBuffer manipulation)
    'Atomics',

    // Collections (memory leaks, prototype pollution)
    'WeakMap',
    'WeakSet',
    'Map',
    'Set',
    'WeakRef',
    'FinalizationRegistry',

    // ES2024+ APIs (sandbox escape vectors)
    'ShadowRealm',
    'Iterator',
    'AsyncIterator',
    'Temporal', // When available

    // Dates (timing attacks)
    'Date',

    // JSON (circular reference attacks)
    'JSON',

    // Browser APIs (if applicable)
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'crypto',
    'performance',

    // Timers (timing attacks)
    'setTimeout',
    'setInterval',
    'setImmediate',
    'clearTimeout',
    'clearInterval',
    'clearImmediate',

    // Import/dynamic loading (Note: 'import' is a keyword, not an identifier)
    // 'import', // Cannot be in disallowed identifiers as it's a reserved keyword
    'importScripts',

    ...(options.additionalDisallowedIdentifiers || []),
  ];
  rules.push(new DisallowedIdentifierRule({ disallowed: disallowedIdentifiers }));

  // Block all loops by default (can be overridden)
  rules.push(
    new ForbiddenLoopRule({
      allowFor: options.allowedLoops?.allowFor ?? false,
      allowWhile: options.allowedLoops?.allowWhile ?? false,
      allowDoWhile: options.allowedLoops?.allowDoWhile ?? false,
      allowForIn: options.allowedLoops?.allowForIn ?? false,
      allowForOf: options.allowedLoops?.allowForOf ?? false,
    }),
  );

  // Block async/await by default (can be overridden)
  rules.push(
    new NoAsyncRule({
      allowAsyncFunctions: options.allowAsync?.allowAsyncFunctions ?? false,
      allowAwait: options.allowAsync?.allowAwait ?? false,
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

  // Analyze regex literals for ReDoS vulnerabilities (strict analysis)
  rules.push(
    new NoRegexLiteralRule({
      blockAll: false,
      analyzePatterns: true,
      analysisLevel: 'catastrophic',
      maxPatternLength: 100, // Stricter limit for strict preset
    }),
  );

  // Block regex methods with dynamic arguments
  rules.push(
    new NoRegexMethodsRule({
      allowStringArguments: true, // Allow safe string arguments
    }),
  );

  return rules;
}
