/**
 * Safe Runtime Wrappers
 *
 * These functions are injected into the AgentScript sandbox to provide
 * safe implementations of tool calls, loops, and other operations.
 *
 * @packageDocumentation
 */

import type { ExecutionContext, ToolHandler } from './types';
import { sanitizeValue } from './value-sanitizer';

/**
 * Create safe runtime context with all __safe_* functions
 *
 * @param context Execution context
 * @returns Object containing all safe runtime functions
 */
export function createSafeRuntime(context: ExecutionContext) {
  const { config, stats } = context;

  /**
   * Safe callTool implementation
   * - Tracks tool call count
   * - Enforces max tool call limit
   * - Delegates to user-provided tool handler
   */
  async function __safe_callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Check if aborted
    if (context.aborted) {
      throw new Error('Execution aborted');
    }

    // Increment tool call count
    stats.toolCallCount++;

    // Check tool call limit
    if (stats.toolCallCount > config.maxToolCalls) {
      throw new Error(
        `Maximum tool call limit exceeded (${config.maxToolCalls}). ` +
        `This limit prevents runaway script execution.`
      );
    }

    // Validate inputs
    if (typeof toolName !== 'string' || !toolName) {
      throw new TypeError('Tool name must be a non-empty string');
    }

    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new TypeError('Tool arguments must be an object');
    }

    // Check for tool handler
    if (!context.toolHandler) {
      throw new Error('No tool handler configured. Cannot execute tool calls.');
    }

    // Execute the tool call
    try {
      const result = await context.toolHandler(toolName, args);

      // Sanitize the return value to prevent:
      // - Function injection
      // - Symbol injection
      // - Prototype pollution (__proto__, constructor)
      // - Deeply nested objects (DoS)
      // - Large object graphs (DoS)
      return sanitizeValue(result, {
        maxDepth: 20,
        maxProperties: 10000,
        allowDates: true,
        allowErrors: true,
      });
    } catch (error: unknown) {
      // Re-throw with context
      const err = error as Error;
      throw new Error(
        `Tool call failed: ${toolName} - ${err.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Safe for-of iterator
   * - Enforces iteration limit per loop
   * - Tracks total iteration count
   */
  function* __safe_forOf<T>(iterable: Iterable<T>): Iterable<T> {
    let iterations = 0;

    for (const item of iterable) {
      // Check if aborted
      if (context.aborted) {
        throw new Error('Execution aborted');
      }

      // Increment iteration count
      iterations++;
      stats.iterationCount++;

      // Check iteration limit
      if (iterations > config.maxIterations) {
        throw new Error(
          `Maximum iteration limit exceeded (${config.maxIterations}). ` +
          `This limit prevents infinite loops.`
        );
      }

      yield item;
    }
  }

  /**
   * Safe for loop wrapper
   * - Enforces iteration limit
   * - Tracks iteration count
   */
  function __safe_for(
    init: () => void,
    test: () => boolean,
    update: () => void,
    body: () => void
  ): void {
    let iterations = 0;

    // Execute init
    init();

    // Execute loop
    while (test()) {
      // Check if aborted
      if (context.aborted) {
        throw new Error('Execution aborted');
      }

      // Increment iteration count
      iterations++;
      stats.iterationCount++;

      // Check iteration limit
      if (iterations > config.maxIterations) {
        throw new Error(
          `Maximum iteration limit exceeded (${config.maxIterations}). ` +
          `This limit prevents infinite loops.`
        );
      }

      // Execute body
      body();

      // Execute update
      update();
    }
  }

  /**
   * Safe while loop wrapper
   * - Enforces iteration limit
   * - Tracks iteration count
   */
  function __safe_while(test: () => boolean, body: () => void): void {
    let iterations = 0;

    while (test()) {
      // Check if aborted
      if (context.aborted) {
        throw new Error('Execution aborted');
      }

      // Increment iteration count
      iterations++;
      stats.iterationCount++;

      // Check iteration limit
      if (iterations > config.maxIterations) {
        throw new Error(
          `Maximum iteration limit exceeded (${config.maxIterations}). ` +
          `This limit prevents infinite loops.`
        );
      }

      // Execute body
      body();
    }
  }

  /**
   * Safe do-while loop wrapper
   * - Enforces iteration limit
   * - Tracks iteration count
   */
  function __safe_doWhile(body: () => void, test: () => boolean): void {
    let iterations = 0;

    do {
      // Check if aborted
      if (context.aborted) {
        throw new Error('Execution aborted');
      }

      // Increment iteration count
      iterations++;
      stats.iterationCount++;

      // Check iteration limit
      if (iterations > config.maxIterations) {
        throw new Error(
          `Maximum iteration limit exceeded (${config.maxIterations}). ` +
          `This limit prevents infinite loops.`
        );
      }

      // Execute body
      body();
    } while (test());
  }

  // Prepare custom globals with __safe_ prefix
  const customGlobalsWithPrefix: Record<string, unknown> = {};
  if (config.globals) {
    for (const [key, value] of Object.entries(config.globals)) {
      customGlobalsWithPrefix[`__safe_${key}`] = value;
    }
  }

  // Return safe runtime object
  return {
    __safe_callTool,
    __safe_forOf,
    __safe_for,
    __safe_while,
    __safe_doWhile,

    // Whitelisted safe globals (passed through)
    Math: Math,
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Date: Date,
    NaN: NaN,
    Infinity: Infinity,
    undefined: undefined,
    isNaN: isNaN,
    isFinite: isFinite,
    parseInt: parseInt,
    parseFloat: parseFloat,

    // Custom globals (with __safe_ prefix for transformed code)
    ...customGlobalsWithPrefix,
  };
}

/**
 * Serialize safe runtime code as a string for injection
 * This is used by sandbox adapters that need to inject the runtime as code
 *
 * @returns JavaScript code string containing the safe runtime
 */
export function serializeSafeRuntime(): string {
  return `
    // Safe callTool implementation
    async function __safe_callTool(toolName, args) {
      if (typeof toolName !== 'string' || !toolName) {
        throw new TypeError('Tool name must be a non-empty string');
      }
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new TypeError('Tool arguments must be an object');
      }

      // This will be replaced by the sandbox adapter with actual implementation
      if (typeof __internal_callTool === 'function') {
        return await __internal_callTool(toolName, args);
      }
      throw new Error('Tool handler not available');
    }

    // Safe for-of iterator
    function* __safe_forOf(iterable) {
      let iterations = 0;
      const maxIterations = __internal_maxIterations || 10000;

      for (const item of iterable) {
        iterations++;
        if (iterations > maxIterations) {
          throw new Error('Maximum iteration limit exceeded (' + maxIterations + ')');
        }
        yield item;
      }
    }

    // Safe for loop
    function __safe_for(init, test, update, body) {
      let iterations = 0;
      const maxIterations = __internal_maxIterations || 10000;

      init();
      while (test()) {
        iterations++;
        if (iterations > maxIterations) {
          throw new Error('Maximum iteration limit exceeded (' + maxIterations + ')');
        }
        body();
        update();
      }
    }

    // Safe while loop
    function __safe_while(test, body) {
      let iterations = 0;
      const maxIterations = __internal_maxIterations || 10000;

      while (test()) {
        iterations++;
        if (iterations > maxIterations) {
          throw new Error('Maximum iteration limit exceeded (' + maxIterations + ')');
        }
        body();
      }
    }

    // Whitelisted globals (already available)
    // Math, JSON, Array, Object, String, Number, Date, etc.
  `.trim();
}
