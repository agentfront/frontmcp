import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { Miniflare } from 'miniflare';

import { mkdtemp, rm, runCmd } from '@frontmcp/utils';

const ROOT_DIR = resolve(__dirname, '../../../../..');
const FIXTURE_DIR = resolve(__dirname, '../../fixture-managed');
const WRANGLER_BIN = join(ROOT_DIR, 'node_modules', '.bin', 'wrangler');
const MCP_URL = 'http://localhost/mcp';
const PUSH_URL = 'http://localhost/__skilled_openapi/push';
const BUNDLE_CACHE_KEY = 'frontmcp:bundle:last-good';

interface JsonRpcResponse {
  result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  error?: { code: number; message: string };
}

export interface ToolCallResult<T> {
  isError: boolean;
  text: string;
  json: () => T;
}

export interface ManagedWorkerOptions {
  bindings: Record<string, string>;
  outbound: (request: Request) => Promise<Response>;
}

/** The fixture Worker, bundled by `wrangler deploy --dry-run` as it would be deployed, and run in workerd. */
export class ManagedWorker {
  private requestId = 0;

  private constructor(
    private readonly miniflare: Miniflare,
    private readonly bundleDir: string,
    private readonly runtimeLog: string[],
  ) {}

  static async start({ bindings, outbound }: ManagedWorkerOptions): Promise<ManagedWorker> {
    const bundleDir = await mkdtemp(join(tmpdir(), 'frontmcp-managed-worker-'));
    await runCmd(WRANGLER_BIN, ['deploy', '--dry-run', '--outdir', bundleDir], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error', CI: '1' },
    });
    const runtimeLog: string[] = [];
    const collect = (stream: Readable) => stream.on('data', (chunk: Buffer) => runtimeLog.push(chunk.toString()));
    const miniflare = new Miniflare({
      modulesRoot: bundleDir,
      modules: [{ type: 'ESModule', path: join(bundleDir, 'worker.js') }],
      compatibilityDate: '2024-09-23',
      compatibilityFlags: ['nodejs_compat'],
      kvNamespaces: ['BUNDLE_CACHE'],
      bindings,
      outboundService: outbound,
      handleRuntimeStdio: (stdout, stderr) => {
        collect(stdout);
        collect(stderr);
      },
    });
    await miniflare.ready;
    return new ManagedWorker(miniflare, bundleDir, runtimeLog);
  }

  /** What the Worker printed, for a failing test's message. */
  get log(): string {
    return this.runtimeLog.join('');
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const worker = await this.miniflare.getWorker();
    return worker.fetch(url, init) as unknown as Promise<Response>;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<ToolCallResult<T>> {
    const response = await this.fetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const message = await readJsonRpc(response);
    if (!message.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(message.error)}\n${this.log}`);
    const text = message.result.content?.find((part) => part.type === 'text')?.text ?? '';
    return { isError: message.result.isError === true, text, json: () => JSON.parse(text) as T };
  }

  /** Run the Cron Trigger handler, as the platform does on schedule. */
  async scheduled(): Promise<{ outcome: string }> {
    const worker = await this.miniflare.getWorker();
    return worker.scheduled({ cron: '*/5 * * * *' });
  }

  push(authorization: string | undefined, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization) headers['authorization'] = authorization;
    return this.fetch(PUSH_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  /** The version of the last good bundle the Worker kept in KV. */
  async cachedBundleVersion(): Promise<string | undefined> {
    const namespace = await this.miniflare.getKVNamespace('BUNDLE_CACHE');
    const cached = await namespace.get(BUNDLE_CACHE_KEY);
    return cached ? (JSON.parse(cached) as { version: string }).version : undefined;
  }

  async dispose(): Promise<void> {
    await this.miniflare.dispose();
    await rm(this.bundleDir, { recursive: true, force: true });
  }
}

/** A JSON-RPC answer, sent as JSON or as one SSE event. */
async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    return dataLine ? (JSON.parse(dataLine.slice('data:'.length).trim()) as JsonRpcResponse) : {};
  }
  return text ? (JSON.parse(text) as JsonRpcResponse) : {};
}
