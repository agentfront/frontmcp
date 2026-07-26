// file: libs/plugins/src/codecall/utils/plain-json.ts

/**
 * Serialize a value into a fresh, plain JSON structure.
 *
 * The result is a JSON projection, not a copy: prototypes, methods, `undefined` members and
 * anything else without a JSON form are gone, and Dates become strings. Callers therefore
 * name the shape they expect (`toPlainJson<MyShape>(value)`) rather than inheriting the
 * input's type, which would over-promise. Returns `undefined` when the value has no JSON
 * representation at all.
 */
export function toPlainJson<T = unknown>(value: unknown): T | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return JSON.parse(serialized) as T;
  } catch {
    return undefined;
  }
}
