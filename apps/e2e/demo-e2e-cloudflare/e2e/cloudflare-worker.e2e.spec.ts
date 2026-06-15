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
import * as path from 'node:path';
import * as fs from 'node:fs';

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

async function mcp(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, json: await res.json() };
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
});
