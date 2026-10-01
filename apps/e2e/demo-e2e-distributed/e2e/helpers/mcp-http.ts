/**
 * Raw MCP-over-HTTP helpers for the distributed E2E specs.
 *
 * The cross-node specs need to send one session's requests to DIFFERENT nodes
 * (initialize on node 0, call a tool on node 1), which a bound MCP client
 * cannot do. These helpers speak Streamable HTTP directly with `fetch`.
 */

export interface McpHttpResponse {
  status: number;
  headers: Headers;
  /** The JSON-RPC message answering the request (parsed from JSON or SSE), if any. */
  message?: { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };
  /** Raw response body. */
  body: string;
}

let nextId = 1;

function parseBody(contentType: string, body: string, id: number): McpHttpResponse['message'] {
  if (!body) return undefined;
  if (contentType.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice('data:'.length).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as NonNullable<McpHttpResponse['message']>;
        if (parsed.id === id) return parsed;
      } catch {
        // not JSON — keep scanning
      }
    }
    return undefined;
  }
  try {
    return JSON.parse(body) as McpHttpResponse['message'];
  } catch {
    return undefined;
  }
}

/** POST a JSON-RPC request (or notification when `notification` is set) to an MCP node. */
export async function mcpPost(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> | undefined,
  options: { sessionId?: string; notification?: boolean } = {},
): Promise<McpHttpResponse> {
  const id = nextId++;
  const payload = options.notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (options.sessionId) headers['mcp-session-id'] = options.sessionId;

  const response = await fetch(`${baseUrl}/`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    message: parseBody(response.headers.get('content-type') ?? '', body, id),
  };
}

/** Run the initialize handshake on a node and return the session id it minted. */
export async function initializeSession(baseUrl: string): Promise<string> {
  const init = await mcpPost(baseUrl, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'distributed-e2e', version: '1.0.0' },
  });
  const sessionId = init.headers.get('mcp-session-id');
  if (init.status !== 200 || !sessionId) {
    throw new Error(`initialize failed on ${baseUrl}: ${init.status} ${init.body.slice(0, 300)}`);
  }
  await mcpPost(baseUrl, 'notifications/initialized', undefined, { sessionId, notification: true });
  return sessionId;
}

/** Call a tool on a node within an existing session. */
export function callTool(
  baseUrl: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpHttpResponse> {
  return mcpPost(baseUrl, 'tools/call', { name, arguments: args }, { sessionId });
}

/** Text of the first content block of a `tools/call` result. */
export function toolText(response: McpHttpResponse): string {
  const content = response.message?.result?.['content'] as Array<{ type: string; text?: string }> | undefined;
  return content?.find((c) => c.type === 'text')?.text ?? '';
}

/** Poll `check` until it returns true or the timeout elapses. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
