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
const READYZ_URL = 'http://localhost/readyz';
const BUNDLE_CACHE_KEY = 'frontmcp:bundle:last-good';
const BUNDLE_CACHE_NAMESPACE_ID = 'e2e-bundle-cache';
const PUSH_REPLAY_CLASS = 'FrontMcpPushReplay';
const FIRST_REPLICA = 'replica-1';
const SECOND_REPLICA = 'replica-2';
const THIRD_REPLICA = 'replica-3';

interface JsonRpcResponse {
  result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  error?: { code: number; message: string };
}

export interface ToolCallResult<T> {
  isError: boolean;
  text: string;
  json: () => T;
}

export interface Readiness {
  httpStatus: number;
  status: string;
  probes?: Record<string, { status: string; details?: Record<string, unknown>; error?: string }>;
}

export interface ManagedWorkerOptions {
  bindings: Record<string, string>;
  outbound: (request: Request) => Promise<Response>;
}

/**
 * The fixture Worker, bundled by `wrangler deploy --dry-run` as it would be deployed, and run in workerd as three
 * replicas: three Workers of one bundle, each in its own isolate with its own memory, sharing the KV namespace and the
 * push replay Durable Object, as the isolates of a deployed Worker do. The tests use the first unless they ask for the
 * {@link ManagedWorker.secondReplica} or the {@link ManagedWorker.thirdReplica}.
 */
export class ManagedWorker {
  private requestId = 0;

  private constructor(
    private readonly miniflare: Miniflare,
    private readonly bundleDir: string,
    private readonly runtimeLog: string[],
    private readonly replicaName = FIRST_REPLICA,
  ) {}

  static async start({ bindings, outbound }: ManagedWorkerOptions): Promise<ManagedWorker> {
    const bundleDir = await mkdtemp(join(tmpdir(), 'frontmcp-managed-worker-'));
    await runCmd(WRANGLER_BIN, ['deploy', '--dry-run', '--outdir', bundleDir], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error', CI: '1' },
    });
    const runtimeLog: string[] = [];
    const collect = (stream: Readable) => stream.on('data', (chunk: Buffer) => runtimeLog.push(chunk.toString()));
    const replica = (
      name: string,
      pushReplayObject: { className: string; scriptName?: string; useSQLite: boolean },
    ) => ({
      name,
      modulesRoot: bundleDir,
      modules: [{ type: 'ESModule' as const, path: join(bundleDir, 'worker.js') }],
      compatibilityDate: '2024-09-23',
      compatibilityFlags: ['nodejs_compat'],
      kvNamespaces: { BUNDLE_CACHE: BUNDLE_CACHE_NAMESPACE_ID },
      durableObjects: { FRONTMCP_PUSH_REPLAY: pushReplayObject },
      bindings,
      outboundService: outbound,
    });
    const miniflare = new Miniflare({
      workers: [
        replica(FIRST_REPLICA, { className: PUSH_REPLAY_CLASS, useSQLite: true }),
        replica(SECOND_REPLICA, { className: PUSH_REPLAY_CLASS, scriptName: FIRST_REPLICA, useSQLite: true }),
        replica(THIRD_REPLICA, { className: PUSH_REPLAY_CLASS, scriptName: FIRST_REPLICA, useSQLite: true }),
      ],
      handleRuntimeStdio: (stdout, stderr) => {
        collect(stdout);
        collect(stderr);
      },
    });
    await miniflare.ready;
    return new ManagedWorker(miniflare, bundleDir, runtimeLog);
  }

  secondReplica(): ManagedWorker {
    return new ManagedWorker(this.miniflare, this.bundleDir, this.runtimeLog, SECOND_REPLICA);
  }

  thirdReplica(): ManagedWorker {
    return new ManagedWorker(this.miniflare, this.bundleDir, this.runtimeLog, THIRD_REPLICA);
  }

  /** What the Worker printed, for a failing test's message. */
  get log(): string {
    return this.runtimeLog.join('');
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const worker = await this.miniflare.getWorker(this.replicaName);
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
    const worker = await this.miniflare.getWorker(this.replicaName);
    return worker.scheduled({ cron: '*/5 * * * *' });
  }

  /** What `/readyz` answers. */
  async readiness(): Promise<Readiness> {
    const response = await this.fetch(READYZ_URL);
    return { httpStatus: response.status, ...((await response.json()) as Omit<Readiness, 'httpStatus'>) };
  }

  /** Push `body`: a string is sent as is, anything else as its JSON. */
  push(authorization: string | undefined, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization) headers['authorization'] = authorization;
    return this.fetch(PUSH_URL, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  /** The version of the last good bundle the Worker kept in KV. */
  async cachedBundleVersion(): Promise<string | undefined> {
    const cached = await this.cachedBundleEntry();
    return cached ? (JSON.parse(cached) as { version: string }).version : undefined;
  }

  /** The KV entry of the last good bundle, as it is stored. */
  async cachedBundleEntry(): Promise<string | null> {
    const namespace = await this.miniflare.getKVNamespace('BUNDLE_CACHE', this.replicaName);
    return namespace.get(BUNDLE_CACHE_KEY);
  }

  /** Store `entry` as the KV entry of the last good bundle, as an earlier deploy of the Worker would have. */
  async storeCachedBundleEntry(entry: string): Promise<void> {
    const namespace = await this.miniflare.getKVNamespace('BUNDLE_CACHE', this.replicaName);
    await namespace.put(BUNDLE_CACHE_KEY, entry);
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
