/**
 * Minimal raw client for MCP protocol revision 2026-07-28.
 *
 * The upstream `@modelcontextprotocol/sdk` client tops out at `2025-11-25`, so
 * the conformance suite drives the wire format directly with `fetch`. Keeping
 * it raw is deliberate: these tests assert on the exact bytes the server emits
 * (headers, `resultType`, `_meta` keys, SSE framing), which a typed client
 * would normalize away.
 */

export const PROTOCOL_20260728 = '2026-07-28';

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_LOG_LEVEL = 'io.modelcontextprotocol/logLevel';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
export const META_SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId';

/** Error codes introduced / renumbered by 2026-07-28. */
export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const INVALID_PARAMS = -32602;
export const METHOD_NOT_FOUND = -32601;

export const DEFAULT_CLIENT_INFO = { name: 'protocol-2026-e2e', version: '1.0.0' };

/**
 * Encode a value for an `Mcp-Name` / `Mcp-Param-*` header.
 *
 * Plain ASCII passes through; anything else (and any literal that would be
 * mistaken for the sentinel) uses the `=?base64?…?=` form the spec defines.
 */
export function encodeHeaderValue(value: string): string {
  const needsEncoding =
    /[^\x20-\x7e]/.test(value) || value !== value.trim() || (value.startsWith('=?base64?') && value.endsWith('?='));

  if (!needsEncoding) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** A server→client request embedded in an `InputRequiredResult` (MRTR). */
export interface InputRequest {
  method: string;
  params?: Record<string, any>;
}

/** A tool as returned by `tools/list`. */
export interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/** A task handle / state as returned by the tasks extension. */
export interface TaskWire {
  taskId: string;
  status: string;
  ttlMs?: number | null;
  pollIntervalMs?: number;
  statusMessage?: string;
  result?: Record<string, any>;
  error?: { code: number; message: string };
  inputRequests?: Record<string, InputRequest>;
}

export interface JsonRpcRequestBody {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpStatelessCallOptions {
  /** JSON-RPC method, e.g. `tools/call`. */
  method: string;
  /** JSON-RPC params, excluding `_meta` (added automatically). */
  params?: Record<string, unknown>;
  id?: string | number;
  /** Protocol version placed in both the header and `_meta`. */
  protocolVersion?: string;
  /** Client capabilities for this request. Defaults to `{}`. */
  clientCapabilities?: Record<string, unknown>;
  clientInfo?: Record<string, unknown> | null;
  logLevel?: string;
  /** Extra `_meta` entries (e.g. MRTR `requestState` lives in params, not here). */
  meta?: Record<string, unknown>;
  /** Header overrides applied AFTER the derived headers — set to null to delete. */
  headers?: Record<string, string | null>;
  /** Skip automatic `Mcp-Method` derivation (for negative tests). */
  omitDerivedHeaders?: boolean;
  accept?: string;
}

export interface McpStatelessResponse {
  status: number;
  headers: Headers;
  text: string;
  json: <T = any>() => T;
}

/** Derive the `Mcp-Name` header value per the spec's source-field table. */
export function deriveMcpName(method: string, params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  if (method === 'tools/call' || method === 'prompts/get') {
    return typeof params['name'] === 'string' ? (params['name'] as string) : undefined;
  }
  if (method === 'resources/read') {
    return typeof params['uri'] === 'string' ? (params['uri'] as string) : undefined;
  }
  return undefined;
}

export function buildMcpStatelessRequest(opts: McpStatelessCallOptions): {
  body: JsonRpcRequestBody;
  headers: Record<string, string>;
} {
  const protocolVersion = opts.protocolVersion ?? PROTOCOL_20260728;

  const meta: Record<string, unknown> = {
    [META_PROTOCOL_VERSION]: protocolVersion,
    [META_CLIENT_CAPABILITIES]: opts.clientCapabilities ?? {},
    ...(opts.clientInfo === null ? {} : { [META_CLIENT_INFO]: opts.clientInfo ?? DEFAULT_CLIENT_INFO }),
    ...(opts.logLevel ? { [META_LOG_LEVEL]: opts.logLevel } : {}),
    ...(opts.meta ?? {}),
  };

  const body: JsonRpcRequestBody = {
    jsonrpc: '2.0',
    ...(opts.id === undefined ? {} : { id: opts.id }),
    method: opts.method,
    params: { ...(opts.params ?? {}), _meta: meta },
  };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: opts.accept ?? 'application/json, text/event-stream',
  };

  if (!opts.omitDerivedHeaders) {
    headers['mcp-protocol-version'] = protocolVersion;
    headers['mcp-method'] = opts.method;
    const name = deriveMcpName(opts.method, opts.params);
    if (name !== undefined) headers['mcp-name'] = encodeHeaderValue(name);
  }

  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    if (value === null) delete headers[key.toLowerCase()];
    else headers[key.toLowerCase()] = value;
  }

  return { body, headers };
}

/** Issue a single 2026-07-28 POST and buffer the whole response. */
export async function mcpStatelessFetch(baseUrl: string, opts: McpStatelessCallOptions): Promise<McpStatelessResponse> {
  const { body, headers } = buildMcpStatelessRequest(opts);

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json: <T = any>(): T => {
      const trimmed = text.trim();
      // A server MAY answer a request with either a single JSON object or an
      // SSE stream — unwrap the latter so callers can assert on the result
      // regardless of which framing the server chose.
      if (trimmed.startsWith('event:') || trimmed.startsWith('data:') || trimmed.startsWith(':')) {
        const events = parseSseEvents(trimmed);
        const last = events[events.length - 1];
        if (!last) throw new Error(`No SSE data frames in response: ${trimmed}`);
        return JSON.parse(last) as T;
      }
      return JSON.parse(trimmed) as T;
    },
  };
}

/** Extract the `data:` payloads from a buffered SSE body, in order. */
export function parseSseEvents(raw: string): string[] {
  const out: string[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length > 0) out.push(dataLines.join('\n'));
  }
  return out;
}

export interface SseStreamHandle {
  /** Resolves once `predicate` matches a received message, or rejects on timeout. */
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  /** Every message received so far, in arrival order. */
  received: () => any[];
  close: () => void;
  /** Response status + headers of the stream itself. */
  status: number;
  headers: Headers;
}

/**
 * Open a long-lived POST/SSE stream (used by `subscriptions/listen`) and expose
 * a small await-based API over the messages that arrive on it.
 */
export async function openMcpStatelessStream(baseUrl: string, opts: McpStatelessCallOptions): Promise<SseStreamHandle> {
  const { body, headers } = buildMcpStatelessRequest(opts);
  const controller = new AbortController();

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  const messages: any[] = [];
  const waiters: { predicate: (msg: any) => boolean; resolve: (msg: any) => void }[] = [];

  const pump = (async () => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
          for (const payload of parseSseEvents(block + '\n\n')) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue;
            }
            messages.push(parsed);
            for (let i = waiters.length - 1; i >= 0; i--) {
              const waiter = waiters[i];
              if (waiter && waiter.predicate(parsed)) {
                waiters.splice(i, 1);
                waiter.resolve(parsed);
              }
            }
          }
        }
      }
    } catch {
      // Stream aborted by close() — expected.
    }
  })();

  return {
    status: res.status,
    headers: res.headers,
    received: () => [...messages],
    waitFor: (predicate, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for SSE message. Received: ${JSON.stringify(messages, null, 2)}`,
            ),
          );
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      }),
    close: () => {
      controller.abort();
      void pump;
    },
  };
}
