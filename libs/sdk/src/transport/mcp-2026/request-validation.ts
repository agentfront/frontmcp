/**
 * Request admission + header validation for protocol 2026-07-28.
 *
 * Two jobs, deliberately separated:
 *
 * 1. **Claim** — decide whether a request belongs to the 2026 pipeline at all.
 *    Anything not claimed falls through to the untouched session/`initialize`
 *    pipeline, which is what keeps older clients working byte-for-byte.
 * 2. **Validate** — enforce the header/body agreement rules of SEP-2243 and the
 *    per-request version rules of SEP-2575.
 */
import { MCP_2026_ERROR_CODES, MCP_2026_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { decodeHeaderValue, hasInvalidHeaderChars, headerMatchesBodyValue } from './header-codec';
import {
  LEGACY_PROTOCOL_VERSIONS,
  MCP_HEADERS,
  NAME_FROM_PARAMS_NAME,
  NAME_FROM_PARAMS_URI,
  PROTOCOL_2026_ONLY_METHODS,
  SUPPORTED_PROTOCOL_VERSIONS_2026,
} from './protocol-2026.constants';

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export type ValidationFailure = { ok: false; status: number; error: JsonRpcErrorPayload };
export type ValidationSuccess = { ok: true; version: string };
export type ValidationResult = ValidationSuccess | ValidationFailure;

/** Case-insensitive header read across the shapes Node/Express/Web produce. */
export function readHeader(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = direct ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** All `Mcp-Param-*` headers, keyed by the lowercased suffix after the prefix. */
export function readParamHeaders(headers: Record<string, unknown> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase();
    if (!lower.startsWith(MCP_HEADERS.paramPrefix)) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') out.set(lower.slice(MCP_HEADERS.paramPrefix.length), raw);
  }
  return out;
}

function metaProtocolVersion(body: unknown): string | undefined {
  const meta = (body as { params?: { _meta?: Record<string, unknown> } } | undefined)?.params?._meta;
  const value = meta?.[MCP_2026_META.protocolVersion];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Decide whether this request belongs to the 2026-07-28 pipeline.
 *
 * Claimed when ANY of:
 * - the body declares a version via the 2026-only `_meta` key (present only in
 *   this revision, so its presence is unambiguous);
 * - the `MCP-Protocol-Version` header names something that is not a revision the
 *   legacy pipeline knows (so an unknown/future version gets a proper
 *   `-32022` instead of a confusing session error);
 * - the method exists only in this revision.
 */
export function isProtocol2026Request(params: {
  headers: Record<string, unknown> | undefined;
  body: unknown;
}): boolean {
  const { headers, body } = params;

  if (metaProtocolVersion(body) !== undefined) return true;

  const headerVersion = readHeader(headers, MCP_HEADERS.protocolVersion);
  if (headerVersion && !LEGACY_PROTOCOL_VERSIONS.includes(headerVersion)) return true;

  const method = (body as { method?: unknown } | undefined)?.method;
  return typeof method === 'string' && PROTOCOL_2026_ONLY_METHODS.includes(method);
}

function headerMismatch(message: string): ValidationFailure {
  return {
    ok: false,
    status: 400,
    error: { code: MCP_2026_ERROR_CODES.headerMismatch, message: `Header mismatch: ${message}` },
  };
}

/**
 * Walk a JSON Schema and collect `x-mcp-header` annotations.
 *
 * Only *statically reachable* properties count — the chain must consist purely
 * of `properties` keys. An annotation behind `items`, `$ref`, or a composition
 * keyword is invalid per the spec and is ignored here rather than being
 * enforced against the client.
 */
export function collectHeaderParams(
  schema: unknown,
  path: string[] = [],
  out: Map<string, string[]> = new Map(),
): Map<string, string[]> {
  if (!schema || typeof schema !== 'object') return out;
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== 'object') return out;

  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object') continue;
    const annotation = (value as Record<string, unknown>)['x-mcp-header'];
    const nextPath = [...path, key];
    if (typeof annotation === 'string' && annotation.length > 0) {
      out.set(annotation.toLowerCase(), nextPath);
    }
    collectHeaderParams(value, nextPath, out);
  }
  return out;
}

/** Read the value at a `properties`-only path within the call arguments. */
function readAtPath(args: unknown, path: string[]): unknown {
  let cursor: unknown = args;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export interface Validate2026Options {
  headers: Record<string, unknown> | undefined;
  body: Record<string, unknown>;
  /** Resolves a tool's input JSON Schema so `x-mcp-header` can be validated. */
  lookupToolSchema?: (toolName: string) => Record<string, unknown> | null | undefined;
}

/**
 * Validate a claimed 2026-07-28 request.
 *
 * Order matters and mirrors the spec's own precedence: transport-level header
 * presence/agreement first, then version support, then the per-method mirrored
 * values. That way a client sending a wrong version AND a wrong method header
 * learns about the version first, which is the actionable one.
 */
export function validate2026Request(options: Validate2026Options): ValidationResult {
  const { headers, body, lookupToolSchema } = options;
  const method = typeof body['method'] === 'string' ? (body['method'] as string) : undefined;

  if (!method) {
    return { ok: false, status: 400, error: { code: -32600, message: 'Invalid Request: missing method' } };
  }

  const headerVersion = readHeader(headers, MCP_HEADERS.protocolVersion);
  const bodyVersion = metaProtocolVersion(body);

  if (!headerVersion) {
    return headerMismatch(`the ${MCP_HEADERS.protocolVersion} header is required`);
  }

  const isNotification = body['id'] === undefined || body['id'] === null;

  // Notification POSTs carry no `_meta` contract in this revision — the spec
  // explicitly leaves their header requirements undefined — so validation stops
  // at the version header.
  if (isNotification) {
    return versionSupported(headerVersion) ?? { ok: true, version: headerVersion };
  }

  if (!bodyVersion) {
    return headerMismatch(`request params._meta must declare "${MCP_2026_META.protocolVersion}"`);
  }
  if (headerVersion !== bodyVersion) {
    return headerMismatch(
      `${MCP_HEADERS.protocolVersion} header value '${headerVersion}' does not match body value '${bodyVersion}'`,
    );
  }

  const unsupported = versionSupported(headerVersion);
  if (unsupported) return unsupported;

  const methodHeader = readHeader(headers, MCP_HEADERS.method);
  if (!methodHeader) {
    return headerMismatch(`the ${MCP_HEADERS.method} header is required`);
  }
  if (methodHeader !== method) {
    return headerMismatch(`${MCP_HEADERS.method} header value '${methodHeader}' does not match body value '${method}'`);
  }

  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};

  const expectsName = NAME_FROM_PARAMS_NAME.includes(method) || NAME_FROM_PARAMS_URI.includes(method);
  if (expectsName) {
    const sourceKey = NAME_FROM_PARAMS_URI.includes(method) ? 'uri' : 'name';
    const bodyValue = params[sourceKey];
    const rawHeader = readHeader(headers, MCP_HEADERS.name);

    if (bodyValue !== undefined) {
      if (rawHeader === undefined) {
        return headerMismatch(`the ${MCP_HEADERS.name} header is required for ${method}`);
      }
      if (hasInvalidHeaderChars(rawHeader)) {
        return headerMismatch(`${MCP_HEADERS.name} header contains invalid characters`);
      }
      const decoded = decodeHeaderValue(rawHeader);
      if (decoded === undefined) {
        return headerMismatch(`${MCP_HEADERS.name} header is not valid base64`);
      }
      if (!headerMatchesBodyValue(decoded, bodyValue)) {
        return headerMismatch(
          `${MCP_HEADERS.name} header value '${decoded}' does not match body value '${String(bodyValue)}'`,
        );
      }
    }
  }

  if (method === 'tools/call' && lookupToolSchema) {
    const failure = validateParamHeaders(headers, params, lookupToolSchema);
    if (failure) return failure;
  }

  return { ok: true, version: headerVersion };
}

function versionSupported(version: string): ValidationFailure | undefined {
  if ((SUPPORTED_PROTOCOL_VERSIONS_2026 as readonly string[]).includes(version)) return undefined;
  return {
    ok: false,
    status: 400,
    error: {
      code: MCP_2026_ERROR_CODES.unsupportedProtocolVersion,
      message: `Unsupported protocol version: ${version}`,
      data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS_2026], requested: version },
    },
  };
}

/**
 * Enforce the `Mcp-Param-{Name}` ⇄ argument agreement.
 *
 * A conforming client mirrors every annotated argument it actually sends. A
 * missing header for a present argument means a non-conforming client, which
 * the spec requires the server to reject — otherwise an intermediary routing on
 * the header and the server executing on the body could disagree.
 */
function validateParamHeaders(
  headers: Record<string, unknown> | undefined,
  params: Record<string, unknown>,
  lookupToolSchema: NonNullable<Validate2026Options['lookupToolSchema']>,
): ValidationFailure | undefined {
  const toolName = typeof params['name'] === 'string' ? (params['name'] as string) : undefined;
  if (!toolName) return undefined;

  const schema = lookupToolSchema(toolName);
  if (!schema) return undefined;

  const annotated = collectHeaderParams(schema);
  if (annotated.size === 0) return undefined;

  const args = params['arguments'];
  const paramHeaders = readParamHeaders(headers);

  for (const [headerName, path] of annotated) {
    const bodyValue = readAtPath(args, path);
    const rawHeader = paramHeaders.get(headerName);

    // Argument absent (or explicitly null) → the client MUST omit the header and
    // the server MUST NOT expect it.
    if (bodyValue === undefined || bodyValue === null) {
      if (rawHeader !== undefined) {
        return headerMismatch(`Mcp-Param-${headerName} was sent but '${path.join('.')}' is absent from the arguments`);
      }
      continue;
    }

    if (rawHeader === undefined) {
      return headerMismatch(`Mcp-Param-${headerName} header is required for argument '${path.join('.')}'`);
    }
    if (hasInvalidHeaderChars(rawHeader)) {
      return headerMismatch(`Mcp-Param-${headerName} header contains invalid characters`);
    }
    const decoded = decodeHeaderValue(rawHeader);
    if (decoded === undefined) {
      return headerMismatch(`Mcp-Param-${headerName} header is not valid base64`);
    }
    if (!headerMatchesBodyValue(decoded, bodyValue)) {
      return headerMismatch(
        `Mcp-Param-${headerName} header value '${decoded}' does not match body value '${String(bodyValue)}'`,
      );
    }
  }

  return undefined;
}

/** The revision this pipeline implements — exported for callers building results. */
export const IMPLEMENTED_PROTOCOL_VERSION = PROTOCOL_2026_07_28;
