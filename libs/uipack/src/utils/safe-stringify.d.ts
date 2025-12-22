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
export declare function safeStringify(value: unknown, space?: number): string;
//# sourceMappingURL=safe-stringify.d.ts.map
