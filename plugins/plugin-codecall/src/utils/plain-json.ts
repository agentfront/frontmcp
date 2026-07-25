// file: libs/plugins/src/codecall/utils/plain-json.ts

/**
 * Serialize a value into a fresh, plain JSON structure. Returns `undefined`
 * when the value cannot be represented as JSON.
 */
export function toPlainJson<T>(value: T): T | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return JSON.parse(serialized) as T;
  } catch {
    return undefined;
  }
}
