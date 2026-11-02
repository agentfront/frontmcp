/**
 * Field redaction for structured log entries and recorded calls.
 *
 * Replaces the values of sensitive fields with '[REDACTED]'.
 */

const REDACTED = '[REDACTED]';

/** The fields a redaction hides: field names, matched case-insensitively, or a test on each key. */
export type RedactedFields = readonly string[] | ((key: string) => boolean);

interface WalkOptions {
  isSensitive: (key: string) => boolean;
  maxDepth: number;
  jsonText: boolean;
}

/**
 * Redact sensitive fields from an object.
 *
 * Performs a shallow clone with redacted values — does not mutate the input.
 *
 * @param obj - Object to redact fields from
 * @param fields - Field names to redact (case-insensitive), or a test on each key
 * @param maxDepth - Maximum recursion depth (default: 5)
 * @returns New object with sensitive fields replaced by '[REDACTED]'
 */
export function redactFields(
  obj: Record<string, unknown>,
  fields: RedactedFields,
  maxDepth = 5,
): Record<string, unknown> {
  if (typeof fields !== 'function' && fields.length === 0) return obj;
  return redactRecord(obj, 0, { isSensitive: sensitiveKeyTest(fields), maxDepth, jsonText: false });
}

/** A copy of a JSON value with its sensitive fields redacted at any depth, also inside strings that hold JSON. */
export function redactJson(value: unknown, fields: RedactedFields): unknown {
  return redactValue(value, 0, { isSensitive: sensitiveKeyTest(fields), maxDepth: Infinity, jsonText: true });
}

function sensitiveKeyTest(fields: RedactedFields): (key: string) => boolean {
  if (typeof fields === 'function') return fields;
  const names = new Set(fields.map((field) => field.toLowerCase()));
  return (key) => names.has(key.toLowerCase());
}

function redactValue(value: unknown, depth: number, options: WalkOptions): unknown {
  if (typeof value === 'string') return options.jsonText ? redactJsonText(value, depth, options) : value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth, options));
  if (isPlainObject(value)) return redactRecord(value, depth, options);
  return value;
}

function redactRecord(obj: Record<string, unknown>, depth: number, options: WalkOptions): Record<string, unknown> {
  if (depth >= options.maxDepth) return obj;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    result[key] = options.isSensitive(key) ? REDACTED : redactValue(value, depth + 1, options);
  }

  return result;
}

function redactJsonText(text: string, depth: number, options: WalkOptions): string {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const redacted = JSON.stringify(redactValue(parsed, depth, options));
  return redacted === JSON.stringify(parsed) ? text : redacted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
