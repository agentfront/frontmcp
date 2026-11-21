import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { Miniflare } from 'miniflare';

import { mkdtemp, readFile, rm, runCmd } from '@frontmcp/utils';

const ROOT_DIR = resolve(__dirname, '../../../../..');
const FIXTURE_DIR = resolve(__dirname, '../../fixture-codecall');
const FRONTMCP_BIN = join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const WRANGLER_BIN = join(ROOT_DIR, 'node_modules', '.bin', 'wrangler');
const MCP_URL = 'http://localhost/mcp';

interface JsonRpcMessage {
  result?: {
    tools?: Array<{ name: string }>;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** What `codecall:execute` answers. */
export interface ExecuteOutcome {
  status: string;
  result?: unknown;
  logs?: string[];
  error?: Record<string, unknown>;
}

async function readJsonRpc(response: Response): Promise<JsonRpcMessage> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    return data ? (JSON.parse(data.slice('data:'.length).trim()) as JsonRpcMessage) : {};
  }
  return text ? (JSON.parse(text) as JsonRpcMessage) : {};
}

/**
 * The CodeCall fixture, built with `frontmcp build --target cloudflare`, bundled by
 * `wrangler deploy --dry-run` exactly as it would be deployed, and run in workerd.
 */
export class CodecallWorker {
  private requestId = 0;

  private constructor(
    private readonly miniflare: Miniflare,
    private readonly bundleDir: string,
    private readonly runtimeLog: string[],
    /** The bundle wrangler would deploy. */
    readonly bundle: string,
  ) {}

  static async start(): Promise<CodecallWorker> {
    await rm(join(FIXTURE_DIR, 'dist'), { recursive: true, force: true });
    await runCmd('node', [FRONTMCP_BIN, 'build', '--target', 'cloudflare'], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, FRONTMCP_LOG_LEVEL: 'error' },
    });

    const bundleDir = await mkdtemp(join(tmpdir(), 'frontmcp-codecall-worker-'));
    await runCmd(WRANGLER_BIN, ['deploy', '--dry-run', '--outdir', bundleDir], {
      cwd: FIXTURE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error', CI: '1' },
    });
    const bundlePath = join(bundleDir, 'index.js');
    const bundle = await readFile(bundlePath);

    const runtimeLog: string[] = [];
    const collect = (stream: Readable) => stream.on('data', (chunk: Buffer) => runtimeLog.push(chunk.toString()));
    const miniflare = new Miniflare({
      modulesRoot: bundleDir,
      modules: [{ type: 'ESModule', path: bundlePath }],
      compatibilityDate: '2024-09-23',
      compatibilityFlags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
      handleRuntimeStdio: (stdout, stderr) => {
        collect(stdout);
        collect(stderr);
      },
    });
    await miniflare.ready;
    return new CodecallWorker(miniflare, bundleDir, runtimeLog, bundle);
  }

  /** What the Worker printed, for a failing test's message. */
  get log(): string {
    return this.runtimeLog.join('');
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<JsonRpcMessage> {
    const response = (await this.miniflare.dispatchFetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }),
    })) as unknown as Response;
    const message = await readJsonRpc(response);
    if (!message.result) throw new Error(`${method} failed: ${JSON.stringify(message.error)}\n${this.log}`);
    return message;
  }

  async listTools(): Promise<string[]> {
    const message = await this.rpc('tools/list', {});
    return (message.result?.tools ?? []).map((tool) => tool.name);
  }

  /** A `tools/call`, answered with its structured content or its text parsed as JSON. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const message = await this.rpc('tools/call', { name, arguments: args });
    if (message.result?.structuredContent) return message.result.structuredContent as T;
    const text = message.result?.content?.find((part) => part.type === 'text')?.text ?? '';
    return JSON.parse(text) as T;
  }

  execute(script: string): Promise<ExecuteOutcome> {
    return this.callTool<ExecuteOutcome>('codecall:execute', { script });
  }

  async stop(): Promise<void> {
    await this.miniflare.dispose();
    await rm(this.bundleDir, { recursive: true, force: true });
  }
}
