/**
 * E2E: a FrontMCP server actually running on Cloudflare Workers (workerd).
 *
 * This is the gold-standard gate for the `--target cloudflare` build + the
 * Web-standard fetch handler: it compiles the fixture worker with the real
 * `frontmcp build --target cloudflare`, boots the output in **workerd** via
 * `wrangler dev`, and drives a real MCP session (initialize → tools/list →
 * tools/call) over HTTP. Nothing here is mocked — if the worker can't boot in a
 * V8 isolate (e.g. an eager `randomUUID()` at module scope, a missing
 * `nodejs_compat` flag, or a Node `req`/`res` shim), this fails.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixture');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const WRANGLER_BIN = path.join(ROOT_DIR, 'node_modules', '.bin', 'wrangler');
const PORT = 8793;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

let worker: ChildProcess | undefined;
let workerLog = '';

async function waitForReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (worker && worker.exitCode !== null) return false; // wrangler died
    try {
      const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Minimal JSON-RPC envelope covering exactly the fields these tests read. */
type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    serverInfo?: { name?: string; version?: string };
    capabilities?: { tools?: unknown; extensions?: Record<string, unknown> };
    tools?: Array<{ name: string }>;
    content?: Array<{ text?: string }>;
    // Protocol 2026-07-28 envelope.
    resultType?: string;
    supportedVersions?: string[];
    ttlMs?: number;
    cacheScope?: string;
    _meta?: Record<string, unknown>;
  };
  error?: { code: number; message: string };
};

async function mcp(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: JsonRpcResponse; headers: Headers }> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, json: await readMcp(res), headers: res.headers };
}

const PROTOCOL_20260728 = '2026-07-28';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/** Issue a fully-conforming 2026-07-28 request, mirrored headers and all. */
async function mcpStateless20260728(
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): Promise<{ status: number; json: JsonRpcResponse; headers: Headers }> {
  const headers: Record<string, string> = {
    'mcp-protocol-version': PROTOCOL_20260728,
    'mcp-method': method,
  };
  const name = method === 'tools/call' ? params['name'] : undefined;
  if (typeof name === 'string') headers['mcp-name'] = name;

  return mcp(
    {
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: { [META_VERSION]: PROTOCOL_20260728, [META_CAPS]: {} } },
    },
    headers,
  );
}

/** Read an MCP response, handling both buffered JSON and the SSE stream the worker emits by default. */
async function readMcp(res: Response): Promise<JsonRpcResponse> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    return dataLine ? (JSON.parse(dataLine.slice('data:'.length).trim()) as JsonRpcResponse) : {};
  }
  return text ? (JSON.parse(text) as JsonRpcResponse) : {};
}

describe('FrontMCP on Cloudflare Workers (workerd)', () => {
  beforeAll(async () => {
    if (!fs.existsSync(FRONTMCP_BIN)) {
      throw new Error(`frontmcp CLI not built at ${FRONTMCP_BIN}. Run \`yarn nx build cli\` first.`);
    }
    if (!fs.existsSync(WRANGLER_BIN)) {
      throw new Error(`wrangler not installed at ${WRANGLER_BIN}. Run \`yarn add -D wrangler\`.`);
    }

    // 1. Build the fixture for Cloudflare (real adapter path).
    fs.rmSync(path.join(FIXTURE_DIR, 'dist'), { recursive: true, force: true });
    execFileSync('node', [FRONTMCP_BIN, 'build', '--target', 'cloudflare'], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, FRONTMCP_LOG_LEVEL: 'error' },
      stdio: 'pipe',
    });

    // 2. Boot the built worker in workerd via wrangler dev.
    worker = spawn(WRANGLER_BIN, ['dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      detached: true,
      stdio: 'pipe',
    });
    worker.stdout?.on('data', (d) => (workerLog += d.toString()));
    worker.stderr?.on('data', (d) => (workerLog += d.toString()));

    const ready = await waitForReady(150000);
    if (!ready) {
      throw new Error(`worker did not become ready. wrangler output:\n${workerLog.slice(-4000)}`);
    }
  }, 170000);

  afterAll(() => {
    if (worker?.pid) {
      try {
        // Kill the whole process group (wrangler + its workerd child).
        process.kill(-worker.pid, 'SIGTERM');
      } catch {
        try {
          worker.kill('SIGTERM');
        } catch {
          // already gone
        }
      }
    }
  });

  it('answers a liveness probe', async () => {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; transport: string };
    expect(body.status).toBe('ok');
    expect(body.transport).toBe('web-fetch');
  });

  it('completes an MCP initialize handshake', async () => {
    const { status, json } = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'cf-e2e', version: '1.0.0' },
      },
    });
    expect(status).toBe(200);
    expect(json.result?.serverInfo?.name).toBe('cf-worker-fixture');
    expect(json.result?.capabilities?.tools).toBeDefined();
  });

  it('lists tools', async () => {
    const { status, json } = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(status).toBe(200);
    const names = (json.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toContain('echo');
  });

  it('executes a tool call', async () => {
    const { status, json } = await mcp({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'hi' } },
    });
    expect(status).toBe(200);
    expect(json.result?.content?.[0]?.text).toBe('Echo: hi');
  });

  /**
   * Protocol 2026-07-28 on the Worker.
   *
   * A V8-isolate deployment defaults to the stateless revision: it needs no
   * session storage, so an MCP call that names no revision is answered directly
   * instead of minting a session in a Durable Object. Clients that DO name a
   * revision still get exactly that one.
   */
  describe('FrontMCP on Cloudflare Workers — protocol 2026-07-28', () => {
    it('serves server/discover natively', async () => {
      const { status, json } = await mcpStateless20260728('server/discover', {}, 10);

      expect(status).toBe(200);
      expect(json.error).toBeUndefined();
      expect(json.result?.supportedVersions).toContain('2026-07-28');
      expect(json.result?.capabilities).toBeDefined();
    });

    it('answers a fully-conforming 2026 tools/call', async () => {
      const { status, json } = await mcpStateless20260728(
        'tools/call',
        { name: 'echo', arguments: { message: 'cf' } },
        11,
      );

      expect(status).toBe(200);
      expect(json.error).toBeUndefined();
      expect(json.result?.resultType).toBe('complete');
      expect(json.result?.content?.[0]?.text).toBe('Echo: cf');
    });

    it('defaults an unversioned call to the stateless pipeline', async () => {
      // No `initialize`, no session id, no version header — on the Worker this is
      // served by the 2026 pipeline. `resultType` + `serverInfo` are the proof:
      // the session-era transport never emits them.
      const { status, json } = await mcp({ jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} });

      expect(status).toBe(200);
      expect(json.result?.resultType).toBe('complete');
      expect(json.result?._meta?.[META_SERVER_INFO]).toBeDefined();
    });

    it('mints no session for a stateless call', async () => {
      const { headers } = await mcp({ jsonrpc: '2.0', id: 13, method: 'tools/list', params: {} });

      // The whole point on a Worker: no session means no Durable Object.
      expect(headers.get('mcp-session-id')).toBeNull();
    });

    it('marks list results cacheable', async () => {
      const { json } = await mcp({ jsonrpc: '2.0', id: 14, method: 'tools/list', params: {} });

      expect(typeof json.result?.ttlMs).toBe('number');
      expect(['public', 'private']).toContain(json.result?.cacheScope);
    });

    it('does NOT require mirrored headers from a client that never opted in', async () => {
      // A pre-2026 client sends no `Mcp-Method` / `Mcp-Name`. Defaulting it to the
      // stateless revision must not turn its working call into a -32020.
      const { status, json } = await mcp({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'lenient' } },
      });

      expect(status).toBe(200);
      expect(json.error).toBeUndefined();
      expect(json.result?.content?.[0]?.text).toBe('Echo: lenient');
    });

    it('still enforces mirrored headers once the client declares 2026', async () => {
      const { status, json } = await mcp(
        {
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/list',
          params: { _meta: { [META_VERSION]: PROTOCOL_20260728, [META_CAPS]: {} } },
        },
        { 'mcp-protocol-version': PROTOCOL_20260728, 'mcp-method': 'resources/list' },
      );

      expect(status).toBe(400);
      expect(json.error?.code).toBe(-32020);
    });

    it('keeps serving the legacy initialize handshake', async () => {
      // The stateless default must not strand a session-based client: an
      // explicit `initialize` still routes to the session-era pipeline.
      const { status, json } = await mcp({
        jsonrpc: '2.0',
        id: 17,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } },
      });

      expect(status).toBe(200);
      expect(json.result?.serverInfo?.name).toBe('cf-worker-fixture');
      // A legacy negotiation must not grow the 2026 envelope.
      expect(json.result?.resultType).toBeUndefined();
      // No `Mcp-Session-Id` assertion here: this fixture binds no Durable
      // Object, so the Worker's legacy path already ran session-less before
      // this change. Sessions on the Worker come from the DO session host.
    });

    it('rejects GET and DELETE on the MCP endpoint', async () => {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${BASE_URL}/mcp`, {
          method,
          headers: { 'mcp-protocol-version': PROTOCOL_20260728 },
          signal: AbortSignal.timeout(10000),
        });
        expect(res.status).toBe(405);
      }
    });
  });
});
