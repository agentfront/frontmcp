/**
 * Client-side `x-mcp-header` handling — protocol 2026-07-28, SEP-2243.
 *
 * A conforming client mirrors annotated tool arguments into `Mcp-Param-{Name}`
 * headers. It must also POLICE the annotations: the spec requires clients to
 * REJECT tool definitions whose `x-mcp-header` values break the rules, and to
 * exclude just those tools from `tools/list` rather than failing the whole list.
 */
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

  // Walk the RAW annotations rather than `collectHeaderParams`, which lowercases
  // into a Map and so silently discards both empty names and case-insensitive
  // duplicates — the two things this function exists to reject.
  const annotated = collectRawHeaderParams(inputSchema);
  const seen = new Set<string>();

  for (const { name, path } of annotated) {
    if (name.length === 0) return { valid: false, reason: 'x-mcp-header must not be empty' };
    if (!TOKEN_RE.test(name)) {
      return { valid: false, reason: `x-mcp-header "${name}" is not a valid HTTP field-name token` };
    }
    // Uniqueness is case-INSENSITIVE: HTTP field names are, so `Region` and
    // `region` would collide into one header.
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      return { valid: false, reason: `x-mcp-header "${name}" is declared more than once` };
    }
    seen.add(normalized);

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

/**
 * Collect every `x-mcp-header` annotation verbatim, including duplicates and
 * empty names, in `properties`-chain order.
 *
 * Deliberately lossless, unlike {@link collectHeaderParams}: validation has to
 * see what the tool author actually wrote before anything is normalized away.
 */
function collectRawHeaderParams(
  schema: unknown,
  path: string[] = [],
  out: Array<{ name: string; path: string[] }> = [],
): Array<{ name: string; path: string[] }> {
  if (!schema || typeof schema !== 'object') return out;
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== 'object') return out;

  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object') continue;
    const annotation = (value as Record<string, unknown>)['x-mcp-header'];
    const nextPath = [...path, key];
    if (typeof annotation === 'string') out.push({ name: annotation, path: nextPath });
    collectRawHeaderParams(value, nextPath, out);
  }
  return out;
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

  // Raw collector, so the header carries the casing the tool author declared
  // (`Mcp-Param-Region`, matching the spec's example). Lookup stays
  // case-insensitive on the server, so either spelling interoperates.
  for (const { name, path } of collectRawHeaderParams(inputSchema)) {
    if (name.length === 0) continue;
    const value = readValueAtPath(args, path);
    if (value === undefined || value === null) continue;

    if (typeof value === 'number' && (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE)) continue;

    const asString = String(value);
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
