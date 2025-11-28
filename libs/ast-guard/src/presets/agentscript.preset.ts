import { ValidationRule } from '../interfaces';
import {
  NoEvalRule,
  DisallowedIdentifierRule,
  NoGlobalAccessRule,
  ForbiddenLoopRule,
  CallArgumentValidationRule,
  ReservedPrefixRule,
  UnknownGlobalRule,
  NoUserDefinedFunctionsRule,
  UnreachableCodeRule,
  StaticCallTargetRule,
  RequiredFunctionCallRule,
  NoRegexLiteralRule,
  NoRegexMethodsRule,
  NoComputedDestructuringRule,
} from '../rules';

/**
 * Configuration options for AgentScript preset
 */
export interface AgentScriptOptions {
  /**
   * List of allowed global identifiers (APIs available to agent code)
   * Default: ['callTool', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Date']
   */
  allowedGlobals?: string[];

  /**
   * Additional identifiers to block beyond the default dangerous set
   */
  additionalDisallowedIdentifiers?: string[];

  /**
   * Whether to allow arrow functions (for array methods like map, filter)
   * Default: true
   */
  allowArrowFunctions?: boolean;

  /**
   * Allow specific loop types
   * Default: { allowFor: true, allowForOf: true } (bounded loops only)
   */
  allowedLoops?: {
    allowFor?: boolean;
    allowWhile?: boolean;
    allowDoWhile?: boolean;
    allowForIn?: boolean;
    allowForOf?: boolean;
  };

  /**
   * Validation rules for callTool arguments
   */
  callToolValidation?: {
    /** Minimum number of arguments */
    minArgs?: number;
    /** Maximum number of arguments */
    maxArgs?: number;
    /** Expected types for each argument position */
    expectedTypes?: Array<'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'literal'>;
  };

  /**
   * Reserved prefixes that user code cannot use
   * Default: ['__ag_', '__safe_']
   */
  reservedPrefixes?: string[];

  /**
   * Configuration for static call target validation
   * Ensures callTool first argument is always a static string literal
   */
  staticCallTarget?: {
    /**
     * Whether to enable static call target validation
     * Default: true
     */
    enabled?: boolean;
    /**
     * Whitelist of allowed tool names (exact strings or RegExp patterns)
     * If provided, only these tools can be called
     */
    allowedToolNames?: (string | RegExp)[];
  };

  /**
   * Whether to require at least one callTool invocation
   * When enabled, scripts that don't call callTool will fail validation
   * Default: false
   */
  requireCallTool?: boolean;
}

/**
 * Creates an AgentScript preset - a strict JS subset for AI agent orchestration
 *
 * **AgentScript Language (v1):**
 * AgentScript is a restricted subset of JavaScript designed for safe orchestration:
 * - Simple, linear code flow (no recursion, no complex control flow)
 * - Tool calls via `await callTool(name, args)`
 * - Data manipulation with array methods (map, filter, reduce)
 * - Bounded loops only (for, for-of with iteration limits)
 * - No access to dangerous globals (process, require, eval, etc.)
 * - No user-defined functions (v1 - prevents recursion)
 *
 * **Use Cases:**
 * - AI agents orchestrating multiple MCP tool calls
 * - Data aggregation across multiple API calls
 * - Simple conditional logic and filtering
 * - Result transformation and formatting
 *
 * **Example AgentScript Code:**
 * ```javascript
 * // Get active admin users
 * const users = await callTool('users:list', {
 *   limit: 100,
 *   filter: { role: 'admin', active: true }
 * });
 *
 * // Get unpaid invoices for each admin
 * const results = [];
 * for (const user of users.items) {
 *   const invoices = await callTool('billing:listInvoices', {
 *     userId: user.id,
 *     status: 'unpaid'
 *   });
 *
 *   if (invoices.items.length > 0) {
 *     results.push({
 *       userId: user.id,
 *       userName: user.name,
 *       unpaidCount: invoices.items.length,
 *       totalAmount: invoices.items.reduce((sum, inv) => sum + inv.amount, 0)
 *     });
 *   }
 * }
 *
 * return results;
 * ```
 *
 * **Security Model:**
 * 1. **Static Validation** (this preset):
 *    - Block dangerous globals (process, require, eval, etc.)
 *    - Block user-defined functions (no recursion)
 *    - Block unknown identifiers (whitelist-only)
 *    - Block reserved prefixes (__ag_, __safe_)
 *    - Allow only safe constructs
 *
 * 2. **Transformation** (separate step):
 *    - Wrap code in `async function __ag_main() {}`
 *    - Transform `callTool` → `__safe_callTool`
 *    - Transform loops → `__safe_for`/`__safe_forOf`
 *
 * 3. **Runtime** (Enclave):
 *    - Execute in isolated sandbox (vm2/nodevm/wasm)
 *    - Provide only `__safe_*` globals
 *    - Enforce timeouts and resource limits
 *
 * @param options Configuration options for the preset
 * @returns Array of configured validation rules
 *
 * @example
 * ```typescript
 * import { createAgentScriptPreset } from 'ast-guard';
 *
 * // Default configuration
 * const rules = createAgentScriptPreset();
 *
 * // Custom configuration
 * const rules = createAgentScriptPreset({
 *   allowedGlobals: ['callTool', 'getTool', 'Math', 'JSON'],
 *   allowArrowFunctions: true,
 *   allowedLoops: { allowFor: true, allowForOf: true },
 * });
 * ```
 */
export function createAgentScriptPreset(options: AgentScriptOptions = {}): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Default allowed globals for AgentScript
  const allowedGlobals = options.allowedGlobals || [
    'callTool', // Primary tool invocation API
    'Math', // Safe mathematical operations
    'JSON', // Safe JSON parsing/stringification
    'Array', // Array constructor
    'Object', // Object methods (filtered at runtime)
    'String', // String methods
    'Number', // Number methods
    'Date', // Date operations
    // Runtime-injected safe functions (created by transformer)
    '__safe_callTool', // Transformed callTool with limits
    '__safe_forOf', // Transformed for-of with iteration tracking
    '__safe_for', // Transformed for with iteration tracking
    '__safe_while', // Transformed while with iteration tracking
    '__safe_doWhile', // Transformed do-while with iteration tracking
  ];

  // 1. Block all eval-like constructs
  rules.push(new NoEvalRule());

  // 2. Block reserved internal prefixes
  rules.push(
    new ReservedPrefixRule({
      reservedPrefixes: options.reservedPrefixes || ['__ag_', '__safe_'],
      allowedIdentifiers: ['__ag_main'], // Allow the compiler wrapper function
    }),
  );

  // 3. Validate all identifiers against whitelist
  rules.push(
    new UnknownGlobalRule({
      allowedGlobals,
      allowStandardGlobals: true, // Allow NaN, Infinity, isNaN, etc.
    }),
  );

  // 4. Block user-defined functions (v1 restriction)
  rules.push(
    new NoUserDefinedFunctionsRule({
      allowArrowFunctions: options.allowArrowFunctions !== false, // default true
      allowFunctionExpressions: false,
      allowedFunctionNames: ['__ag_main'], // Allow compiler wrapper
    }),
  );

  // 5. Block dangerous global object access patterns
  rules.push(
    new NoGlobalAccessRule({
      blockedGlobals: ['window', 'globalThis', 'self', 'global', 'this'],
      blockMemberAccess: true,
      blockComputedAccess: true,
    }),
  );

  // 6. Block comprehensive list of dangerous identifiers
  const dangerousIdentifiers = [
    // Node.js/System access
    'process',
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
    'Buffer',

    // Code execution (already blocked by NoEvalRule, but include for clarity)
    'eval',
    'Function',
    'AsyncFunction',
    'GeneratorFunction',

    // Prototype manipulation
    'constructor',
    '__proto__',
    'prototype',

    // Reflection and meta-programming
    'Proxy',
    'Reflect',

    // Error manipulation (stack traces can leak)
    'Error',
    'TypeError',
    'ReferenceError',
    'SyntaxError',
    'RangeError',
    'URIError',
    'EvalError',
    'AggregateError',

    // Web APIs (if in browser context)
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

    // WebAssembly (native code execution)
    'WebAssembly',

    // Workers (sandbox escape)
    'Worker',
    'SharedWorker',
    'ServiceWorker',

    // Weak references (can hold references to sensitive objects, harder to audit)
    'WeakMap',
    'WeakSet',
    'WeakRef',
    'FinalizationRegistry',

    // Additional dangerous globals
    'Atomics',
    'SharedArrayBuffer',
    'importScripts',

    // Dangerous JavaScript APIs (potential sandbox escape vectors)
    'ShadowRealm', // Escape via isolated execution
    'Iterator', // Iterator helpers can access prototype chain
    'AsyncIterator', // Async iterator helpers can access prototype chain

    ...(options.additionalDisallowedIdentifiers || []),
  ];
  rules.push(new DisallowedIdentifierRule({ disallowed: dangerousIdentifiers }));

  // 7. Configure loop restrictions
  rules.push(
    new ForbiddenLoopRule({
      allowFor: options.allowedLoops?.allowFor ?? true, // default true (bounded)
      allowWhile: options.allowedLoops?.allowWhile ?? false, // default false (unbounded)
      allowDoWhile: options.allowedLoops?.allowDoWhile ?? false, // default false (unbounded)
      allowForIn: options.allowedLoops?.allowForIn ?? false, // default false (prototype walking)
      allowForOf: options.allowedLoops?.allowForOf ?? true, // default true (safe iteration)
    }),
  );

  // 8. Validate callTool arguments (if configured)
  if (options.callToolValidation) {
    rules.push(
      new CallArgumentValidationRule({
        functions: {
          callTool: {
            minArgs: options.callToolValidation.minArgs || 2,
            maxArgs: options.callToolValidation.maxArgs || 2,
            expectedTypes: options.callToolValidation.expectedTypes || ['string', 'object'],
          },
        },
      }),
    );
  }

  // 9. Detect unreachable code
  rules.push(new UnreachableCodeRule());

  // 10. Enforce static string literals for callTool targets (default: enabled)
  if (options.staticCallTarget?.enabled !== false) {
    rules.push(
      new StaticCallTargetRule({
        targetFunctions: ['callTool', '__safe_callTool'],
        allowedToolNames: options.staticCallTarget?.allowedToolNames,
      }),
    );
  }

  // 11. Require at least one callTool invocation (optional, default: disabled)
  if (options.requireCallTool) {
    rules.push(
      new RequiredFunctionCallRule({
        required: ['callTool'],
        minCalls: 1,
        messageTemplate: 'AgentScript code must contain at least one callTool invocation',
      }),
    );
  }

  // 12. Block ALL regex literals (ReDoS prevention)
  // AgentScript agents should use API filtering, not regex
  rules.push(
    new NoRegexLiteralRule({
      blockAll: true, // Block all regex literals in AgentScript
    }),
  );

  // 13. Block regex methods on strings and regex objects
  // Prevents ReDoS via .match(), .test(), .replace(), etc.
  rules.push(
    new NoRegexMethodsRule({
      allowStringArguments: false, // Block even string arguments for maximum security
    }),
  );

  // 14. Block computed property names in destructuring patterns
  // This prevents runtime property name construction attacks like:
  //   const {['const'+'ructor']:Func} = callTool;  // Bypasses static analysis!
  rules.push(new NoComputedDestructuringRule());

  return rules;
}
