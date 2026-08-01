/**
 * Client-side `x-mcp-header` handling — protocol 2026-07-28, SEP-2243.
 *
 * A conforming client mirrors annotated tool arguments into `Mcp-Param-{Name}`
 * headers. It must also POLICE the annotations: the spec requires clients to
 * REJECT tool definitions whose `x-mcp-header` values break the rules, and to
 * exclude just those tools from `tools/list` rather than failing the whole list.
 */
import { collectHeaderParams } from '../request-validation';

/** RFC 9110 field-name token characters. */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Largest integer that survives a JSON round trip without precision loss. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export interface HeaderParamValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validate every `x-mcp-header` annotation in a tool's input schema.
 *
 * Checks the constraints the spec places on annotation NAMES (non-empty, token
 * syntax, no control characters, case-insensitively unique) and on the annotated
 * property TYPES (primitive; `number` is excluded because it cannot round-trip
 * exactly, integers must stay in the safe range).
 */
export function validateHeaderParams(inputSchema: unknown): HeaderParamValidation {
  if (!inputSchema || typeof inputSchema !== 'object') return { valid: true };

  const annotated = collectHeaderParams(inputSchema);
  const seen = new Set<string>();

  for (const [name, path] of annotated) {
    if (name.length === 0) return { valid: false, reason: 'x-mcp-header must not be empty' };
    if (!TOKEN_RE.test(name)) {
      return { valid: false, reason: `x-mcp-header "${name}" is not a valid HTTP field-name token` };
    }
    if (seen.has(name)) {
      return { valid: false, reason: `x-mcp-header "${name}" is declared more than once` };
    }
    seen.add(name);

    const type = readTypeAtPath(inputSchema, path);
    if (type === 'number') {
      return { valid: false, reason: `x-mcp-header "${name}" annotates a number, which is not permitted` };
    }
    if (type !== undefined && !['string', 'integer', 'boolean'].includes(type)) {
      return { valid: false, reason: `x-mcp-header "${name}" annotates a non-primitive type "${type}"` };
    }
  }

  return { valid: true };
}

/** Read the declared `type` of a property reachable through a `properties` chain. */
function readTypeAtPath(schema: unknown, path: string[]): string | undefined {
  let cursor: unknown = schema;
  for (const segment of path) {
    const properties = (cursor as { properties?: Record<string, unknown> } | undefined)?.properties;
    if (!properties) return undefined;
    cursor = properties[segment];
  }
  const type = (cursor as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * Build the `Mcp-Param-*` headers for a tool call.
 *
 * A header is emitted only when the annotated argument is actually present —
 * the spec pairs "value provided" with "client MUST include the header" and
 * "value absent/null" with "client MUST omit it".
 */
export function buildParamHeaders(
  inputSchema: unknown,
  args: unknown,
  encode: (value: string) => string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!inputSchema || typeof inputSchema !== 'object') return headers;

  for (const [name, path] of collectHeaderParams(inputSchema)) {
    const value = readValueAtPath(args, path);
    if (value === undefined || value === null) continue;

    if (typeof value === 'number' && (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE)) continue;

    const asString = typeof value === 'boolean' ? String(value) : String(value);
    headers[`Mcp-Param-${name}`] = encode(asString);
  }

  return headers;
}

function readValueAtPath(args: unknown, path: string[]): unknown {
  let cursor: unknown = args;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
