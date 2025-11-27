/**
 * Globals Validator - Custom Globals Security Validation
 *
 * Validates custom globals passed to the enclave to prevent:
 * - Function injection (closures can leak host scope)
 * - Getter/Setter traps (can execute arbitrary code on access)
 * - Symbol properties (can be used for prototype manipulation)
 * - Deeply nested objects (DoS via recursion)
 * - Dangerous patterns in function source
 *
 * @packageDocumentation
 */

/**
 * Options for globals validation
 */
export interface GlobalsValidationOptions {
  /**
   * Maximum depth of nested objects
   * @default 10
   */
  maxDepth?: number;

  /**
   * Whether to allow functions in globals
   * @default false
   */
  allowFunctions?: boolean;

  /**
   * Whether to allow getter/setter properties
   * @default false
   */
  allowGettersSetters?: boolean;

  /**
   * List of specifically allowed function names (if allowFunctions is false)
   */
  allowedFunctionNames?: string[];
}

/**
 * Patterns that indicate dangerous functions
 * These patterns in function source code suggest the function could be used for attacks
 */
const DANGEROUS_FUNCTION_PATTERNS = [
  /\beval\b/, // eval() calls
  /\bFunction\b/, // Function constructor
  /\brequire\b/, // CommonJS require
  /\bimport\b/, // ES imports
  /\bprocess\b/, // Node.js process
  /\bglobal\b/, // Global object
  /\bglobalThis\b/, // Global this reference
  /\b__dirname\b/, // Directory name
  /\b__filename\b/, // File name
  /\bchild_process\b/, // Child process module
  /\bexecSync\b/, // Synchronous exec
  /\bspawnSync\b/, // Synchronous spawn
];

/**
 * Keys that are dangerous in global objects
 */
const DANGEROUS_GLOBAL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate a single global value recursively
 *
 * @param key The global key name
 * @param value The value to validate
 * @param options Validation options
 * @param path Current path for error messages
 * @param visited WeakSet to track visited objects (circular reference detection)
 * @throws Error if validation fails
 */
export function validateGlobalValue(
  key: string,
  value: unknown,
  options: GlobalsValidationOptions = {},
  path: string[] = [],
  visited: WeakSet<object> = new WeakSet(),
): void {
  const maxDepth = options.maxDepth ?? 10;
  const allowFunctions = options.allowFunctions ?? false;
  const allowGettersSetters = options.allowGettersSetters ?? false;
  const allowedFunctionNames = options.allowedFunctionNames ?? [];

  // Check depth limit
  if (path.length > maxDepth) {
    throw new Error(
      `Custom global "${key}" exceeds maximum depth (${maxDepth}). ` +
        `Path: ${path.join('.')}. ` +
        `This limit prevents deeply nested objects that could cause stack overflow.`,
    );
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return;
  }

  const type = typeof value;

  // Primitives are always safe
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return;
  }

  // Symbols are not allowed (can be used for prototype manipulation)
  if (type === 'symbol') {
    throw new Error(
      `Custom global "${key}" contains a symbol at ${path.join('.') || 'root'}. ` +
        `Symbols are not allowed in custom globals as they can be used for prototype manipulation.`,
    );
  }

  // Functions need special handling
  if (type === 'function') {
    // Check if this specific function is allowed by name
    const funcName = (value as Function).name || 'anonymous';
    if (allowedFunctionNames.includes(funcName)) {
      return;
    }

    if (!allowFunctions) {
      throw new Error(
        `Custom global "${key}" contains a function at ${path.join('.') || 'root'}. ` +
          `Functions are not allowed by default in custom globals because they can leak host scope via closures. ` +
          `Use allowFunctions: true if you understand the security implications.`,
      );
    }

    // If functions are allowed, check for dangerous patterns
    try {
      const fnSource = String(value);
      for (const pattern of DANGEROUS_FUNCTION_PATTERNS) {
        if (pattern.test(fnSource)) {
          throw new Error(
            `Custom global "${key}" contains a function with dangerous pattern "${pattern.source}" ` +
              `at ${path.join('.') || 'root'}. ` +
              `This function may be able to access host resources.`,
          );
        }
      }
    } catch (e) {
      // If we can't convert to string, that's suspicious
      if ((e as Error).message.includes('dangerous pattern')) {
        throw e;
      }
      // Otherwise allow (some functions can't be stringified)
    }

    return;
  }

  // Handle objects
  if (type === 'object') {
    const obj = value as object;

    // Check for circular references
    if (visited.has(obj)) {
      return; // Already validated this object
    }
    visited.add(obj);

    // Check for getters/setters
    if (!allowGettersSetters) {
      const descriptors = Object.getOwnPropertyDescriptors(obj);
      for (const [prop, desc] of Object.entries(descriptors)) {
        if (desc.get || desc.set) {
          throw new Error(
            `Custom global "${key}" has a getter/setter at ${[...path, prop].join('.')}. ` +
              `Getters and setters are not allowed because they can execute arbitrary code on property access. ` +
              `Use allowGettersSetters: true if you understand the security implications.`,
          );
        }
      }
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        validateGlobalValue(key, obj[i], options, [...path, String(i)], visited);
      }
      return;
    }

    // Handle plain objects
    const keys = Object.keys(obj);
    for (const prop of keys) {
      // Check for dangerous keys
      if (DANGEROUS_GLOBAL_KEYS.has(prop)) {
        throw new Error(
          `Custom global "${key}" contains dangerous key "${prop}" at ${path.join('.') || 'root'}. ` +
            `Keys like "__proto__", "constructor", and "prototype" are not allowed.`,
        );
      }

      try {
        const propValue = (obj as Record<string, unknown>)[prop];
        validateGlobalValue(key, propValue, options, [...path, prop], visited);
      } catch (e) {
        // Re-throw validation errors
        throw e;
      }
    }

    return;
  }

  // Unknown type - probably okay but log warning
  console.warn(`Custom global "${key}" has unknown type "${type}" at ${path.join('.') || 'root'}`);
}

/**
 * Validate all custom globals
 *
 * @param globals Object containing all custom globals
 * @param options Validation options
 * @throws Error if any global fails validation
 *
 * @example
 * ```typescript
 * validateGlobals({
 *   count: 42,
 *   name: 'test',
 *   // data: { fn: () => {} }, // Would throw!
 * });
 * ```
 */
export function validateGlobals(globals: Record<string, unknown>, options: GlobalsValidationOptions = {}): void {
  for (const [key, value] of Object.entries(globals)) {
    validateGlobalValue(key, value, options);
  }
}

/**
 * Check if globals can be safely validated without throwing
 *
 * @param globals Object containing all custom globals
 * @param options Validation options
 * @returns true if validation will succeed, false otherwise
 */
export function canValidateGlobals(globals: Record<string, unknown>, options: GlobalsValidationOptions = {}): boolean {
  try {
    validateGlobals(globals, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get validation errors for globals without throwing
 *
 * @param globals Object containing all custom globals
 * @param options Validation options
 * @returns Array of validation error messages, empty if valid
 */
export function getGlobalsValidationErrors(
  globals: Record<string, unknown>,
  options: GlobalsValidationOptions = {},
): string[] {
  const errors: string[] = [];

  for (const [key, value] of Object.entries(globals)) {
    try {
      validateGlobalValue(key, value, options);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return errors;
}
