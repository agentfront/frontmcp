/**
 * Field redaction utilities for structured log entries.
 *
 * Traverses objects and replaces values of sensitive fields with '[REDACTED]'.
 */

const REDACTED = '[REDACTED]';

/**
 * Redact sensitive fields from an object.
 *
 * Performs a shallow clone with redacted values — does not mutate the input.
 * Field matching is case-insensitive.
 *
 * @param obj - Object to redact fields from
 * @param fields - Field names to redact (case-insensitive)
 * @param maxDepth - Maximum recursion depth (default: 5)
 * @returns New object with sensitive fields replaced by '[REDACTED]'
 */
export function redactFields(obj: Record<string, unknown>, fields: string[], maxDepth = 5): Record<string, unknown> {
  if (fields.length === 0) return obj;

  const lowerFields = new Set(fields.map((f) => f.toLowerCase()));
  return redactRecursive(obj, lowerFields, 0, maxDepth);
}

function redactRecursive(
  obj: Record<string, unknown>,
  fields: Set<string>,
  depth: number,
  maxDepth: number,
): Record<string, unknown> {
  if (depth >= maxDepth) return obj;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (fields.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else if (isPlainObject(value)) {
      result[key] = redactRecursive(value as Record<string, unknown>, fields, depth + 1, maxDepth);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) ? redactRecursive(item as Record<string, unknown>, fields, depth + 1, maxDepth) : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
