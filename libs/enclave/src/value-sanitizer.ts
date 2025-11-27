/**
 * Value Sanitizer - Tool Handler Return Value Security
 *
 * Sanitizes values returned from tool handlers to prevent:
 * - Function injection (return values containing executable functions)
 * - Symbol injection (symbols can be used for prototype manipulation)
 * - Prototype pollution (__proto__, constructor keys)
 * - Deeply nested objects (DoS via recursion)
 * - Large object graphs (DoS via memory exhaustion)
 *
 * @packageDocumentation
 */

/**
 * Options for value sanitization
 */
export interface SanitizeOptions {
  /**
   * Maximum depth of nested objects/arrays
   * @default 20
   */
  maxDepth?: number;

  /**
   * Maximum total number of properties across all nested objects
   * @default 10000
   */
  maxProperties?: number;

  /**
   * Whether to allow Date objects (converted to ISO strings if false)
   * @default true
   */
  allowDates?: boolean;

  /**
   * Whether to allow Error objects (converted to plain objects)
   * @default true
   */
  allowErrors?: boolean;
}

/**
 * Keys that are stripped from sanitized objects for security
 * - __proto__: Prototype pollution vector
 * - constructor: Constructor chain escape vector
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor']);

/**
 * Property counter for tracking total properties across recursive calls
 */
interface PropertyCounter {
  count: number;
}

/**
 * Internal context for tracking visited objects (circular reference detection)
 */
interface SanitizeContext {
  propCount: PropertyCounter;
  visited: WeakSet<object>;
}

/**
 * Sanitize a value returned from a tool handler
 *
 * Security features:
 * - Strips functions (prevent code injection)
 * - Strips symbols (prevent prototype manipulation)
 * - Removes __proto__ and constructor keys (prevent prototype pollution)
 * - Creates null-prototype objects (prevent prototype chain attacks)
 * - Enforces max depth (prevent DoS via deep recursion)
 * - Enforces max properties (prevent DoS via memory exhaustion)
 *
 * @param value The value to sanitize
 * @param options Sanitization options
 * @param depth Current recursion depth (internal)
 * @param propCount Property counter (internal)
 * @returns Sanitized value safe for sandbox use
 * @throws Error if value contains functions, symbols, or exceeds limits
 *
 * @example
 * ```typescript
 * const toolResult = await toolHandler('getData', {});
 * const safeResult = sanitizeValue(toolResult);
 * ```
 */
export function sanitizeValue(
  value: unknown,
  options: SanitizeOptions = {},
  depth = 0,
  context: SanitizeContext = { propCount: { count: 0 }, visited: new WeakSet() },
): unknown {
  const maxDepth = options.maxDepth ?? 20;
  const maxProperties = options.maxProperties ?? 10000;
  const allowDates = options.allowDates ?? true;
  const allowErrors = options.allowErrors ?? true;

  // Check depth limit
  if (depth > maxDepth) {
    throw new Error(
      `Tool handler return value exceeds maximum depth (${maxDepth}). ` +
        `This limit prevents deeply nested objects that could cause stack overflow.`,
    );
  }

  // Check property count limit
  if (context.propCount.count > maxProperties) {
    throw new Error(
      `Tool handler return value exceeds maximum properties (${maxProperties}). ` +
        `This limit prevents memory exhaustion from large object graphs.`,
    );
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;

  // Primitives are safe
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return value;
  }

  // Functions are NOT safe - prevent code injection
  if (type === 'function') {
    throw new Error(
      'Tool handler returned a function. Functions cannot be returned to sandbox code ' +
        'as they could be used for code injection or host scope access.',
    );
  }

  // Symbols are NOT safe - prevent prototype manipulation
  if (type === 'symbol') {
    throw new Error(
      'Tool handler returned a symbol. Symbols cannot be returned to sandbox code ' +
        'as they could be used for prototype manipulation.',
    );
  }

  // Check for circular references (only for objects)
  if (type === 'object' && value !== null) {
    if (context.visited.has(value as object)) {
      // Return a marker for circular references instead of infinite recursion
      return '[Circular]';
    }
    context.visited.add(value as object);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    context.propCount.count += value.length;
    if (context.propCount.count > maxProperties) {
      throw new Error(`Tool handler return value exceeds maximum properties (${maxProperties}).`);
    }
    return value.map((item) => sanitizeValue(item, options, depth + 1, context));
  }

  // Handle Date objects
  if (value instanceof Date) {
    if (allowDates) {
      // Return a new Date to prevent reference sharing
      return new Date(value.getTime());
    }
    // Convert to ISO string if dates not allowed
    return value.toISOString();
  }

  // Handle Error objects
  if (value instanceof Error) {
    if (allowErrors) {
      // Convert to plain object with safe properties only
      return {
        name: value.name,
        message: value.message,
        // Do NOT include stack trace - could leak host information
      };
    }
    return { error: value.message };
  }

  // Handle RegExp objects (convert to string)
  if (value instanceof RegExp) {
    return value.toString();
  }

  // Handle Map objects
  if (value instanceof Map) {
    const sanitizedMap: Record<string, unknown> = Object.create(null);
    for (const [key, val] of value.entries()) {
      if (typeof key !== 'string') continue; // Only string keys
      if (DANGEROUS_KEYS.has(key)) continue; // Skip dangerous keys
      context.propCount.count++;
      sanitizedMap[key] = sanitizeValue(val, options, depth + 1, context);
    }
    return sanitizedMap;
  }

  // Handle Set objects (convert to array)
  if (value instanceof Set) {
    const arr = Array.from(value);
    context.propCount.count += arr.length;
    return arr.map((item) => sanitizeValue(item, options, depth + 1, context));
  }

  // Handle plain objects
  if (type === 'object') {
    // Create null-prototype object to prevent prototype chain attacks
    const sanitized: Record<string, unknown> = Object.create(null);

    // Get own enumerable string keys only
    const keys = Object.keys(value as Record<string, unknown>);
    context.propCount.count += keys.length;

    if (context.propCount.count > maxProperties) {
      throw new Error(`Tool handler return value exceeds maximum properties (${maxProperties}).`);
    }

    for (const key of keys) {
      // Skip dangerous keys
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }

      // Try to access the property (may throw if getter trap)
      let propValue: unknown;
      try {
        propValue = (value as Record<string, unknown>)[key];
      } catch {
        // Skip properties that throw on access (likely getter traps)
        continue;
      }

      // Recursively sanitize - DO NOT catch these errors, let them propagate
      sanitized[key] = sanitizeValue(propValue, options, depth + 1, context);
    }

    return sanitized;
  }

  // Unknown type - convert to string
  return String(value);
}

/**
 * Check if a value can be safely sanitized without throwing
 *
 * @param value Value to check
 * @param options Sanitization options
 * @returns true if sanitization will succeed, false otherwise
 */
export function canSanitize(value: unknown, options: SanitizeOptions = {}): boolean {
  try {
    sanitizeValue(value, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize value with fallback on error
 *
 * @param value Value to sanitize
 * @param fallback Fallback value if sanitization fails
 * @param options Sanitization options
 * @returns Sanitized value or fallback
 */
export function sanitizeValueOrFallback<T>(value: unknown, fallback: T, options: SanitizeOptions = {}): unknown | T {
  try {
    return sanitizeValue(value, options);
  } catch {
    return fallback;
  }
}
