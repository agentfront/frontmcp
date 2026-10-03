/**
 * `frontmcp build --target node` carries the deployment's `frontmcp.config` run-time
 * settings into the bundle (#680): `server.http.port`, `server.http.cors` and the
 * build target (`availableWhen: { target }`), applied when the bundle is run directly
 * — as the generated Dockerfile's `CMD` does — with an explicit env var still winning.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import * as path from 'path';

import { ensureDir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { runFrontmcpCli } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://app.example.com';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`server at ${url} did not start`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function rpc(port: number, body: unknown, sessionId?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      origin: ORIGIN,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readRpcResult(response: Response): Promise<{ result?: { tools?: Array<{ name: string }> } }> {
  const text = await response.text();
  const data = text.includes('data:')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .pop()
    : text;
  return JSON.parse(data ?? '{}');
}

describe('build --target node applies frontmcp.config run-time defaults (#680)', () => {
  let projectDir: string;
  let port: number;
  let server: ChildProcess | undefined;

  beforeAll(async () => {
    port = await freePort();
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-runtime-defaults-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'node-only', description: 'Offered by the node build only', inputSchema: {}, availableWhen: { target: ['node'] } })
class NodeOnlyTool extends ToolContext {
  async execute() {
    return 'node';
  }
}

@App({ name: 'runtime', tools: [NodeOnlyTool] })
class RuntimeApp {}

@FrontMcp({
  info: { name: 'Runtime Defaults', version: '1.0.0' },
  apps: [RuntimeApp],
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn, enableConsole: false },
})
export default class Server {}
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: 'runtime-demo',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [
    {
      target: 'node',
      server: { http: { port: ${port}, cors: { origins: [${JSON.stringify(ORIGIN)}] } } },
    },
  ],
};\n`,
    );
  });

  afterAll(async () => {
    server?.kill('SIGKILL');
    await rm(projectDir, { recursive: true, force: true });
  });

  it('builds, and the bundle records the node target', async () => {
    const { exitCode, stderr, stdout } = runFrontmcpCli(['build', '--target', 'node'], undefined, projectDir);
    expect({ exitCode, stderr: stderr.split('\n').filter((l) => /error/i.test(l)) }).toEqual({
      exitCode: 0,
      stderr: [],
    });
    expect(stdout).toBeDefined();
    const bundle = await readFile(path.join(projectDir, 'dist', 'node', 'runtime-demo.bundle.js'));
    expect(bundle).toContain('globalThis.FRONTMCP_BUILD_TARGET || "node"');
  }, 120_000);

  it('run directly, the bundle listens on server.http.port, answers CORS and offers node-only tools', async () => {
    const env = { ...process.env };
    delete env['PORT'];
    server = spawn(process.execPath, [path.join(projectDir, 'dist', 'node', 'runtime-demo.bundle.js')], {
      cwd: projectDir,
      env,
      stdio: 'ignore',
    });
    await waitForHttp(`http://127.0.0.1:${port}/`, 60_000);

    const init = await rpc(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const sessionId = init.headers.get('mcp-session-id') ?? undefined;
    await init.text();
    await (await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)).text();

    const tools = await readRpcResult(await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId));
    expect(tools.result?.tools?.map((t) => t.name)).toContain('node-only');
  }, 120_000);
});
