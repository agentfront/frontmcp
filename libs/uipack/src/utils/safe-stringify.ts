/**
 * @file safe-stringify.ts
 * @description Safe JSON stringification utility that handles circular references and edge cases.
 *
 * This prevents tool calls from failing due to serialization errors when
 * the output contains circular references or non-serializable values.
 */

/**
 * Safely stringify a value, handling circular references and other edge cases.
 *
 * @param value - The value to stringify
 * @param space - Optional indentation for pretty-printing (passed to JSON.stringify)
 * @returns JSON string representation of the value
 *
 * @example
 * ```typescript
 * // Normal object
 * safeStringify({ name: 'test' }); // '{"name":"test"}'
 *
 * // Circular reference
 * const obj = { name: 'test' };
 * obj.self = obj;
 * safeStringify(obj); // '{"name":"test","self":"[Circular]"}'
 *
 * // Pretty print
 * safeStringify({ name: 'test' }, 2); // '{\n  "name": "test"\n}'
 * ```
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      space,
    );
  } catch {
    return JSON.stringify({ error: 'Output could not be serialized' });
  }
}
