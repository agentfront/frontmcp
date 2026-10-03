/**
 * Helpers for E2E specs that drive the compiled `frontmcp` CLI against a
 * scratch project: `frontmcp dev`, `frontmcp dev --stdio`, builds from a
 * subfolder.
 *
 * Scratch projects live inside this app (`.scratch-*`) so `node_modules`
 * resolves upward to the repo root — `@frontmcp/sdk`, `tsx` and `reflect-metadata`
 * come from the workspace, with no install step.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';

import { mkdir, mkdtemp, writeFile } from '@frontmcp/utils';

export const ROOT_DIR = path.resolve(__dirname, '../../../../..');
export const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const SCRATCH_ROOT = path.resolve(__dirname, '../..');

/** Create `apps/e2e/demo-e2e-cli-exec/.scratch-<prefix>-*` holding `files`. */
export async function createScratchProject(prefix: string, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(SCRATCH_ROOT, `.scratch-${prefix}-`));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return dir;
}

/** A FrontMCP server with one `hello` tool, the decorator in `src/main.ts`. */
export function helloServerFiles(options: { http?: string; greeting?: string } = {}): Record<string, string> {
  return {
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'es2021',
          module: 'esnext',
          moduleResolution: 'node',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          strict: true,
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'src/hello.tool.ts': helloToolSource(options.greeting ?? 'Hello'),
    'src/main.ts': `import 'reflect-metadata';
import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';
import HelloTool from './hello.tool';

@App({ id: 'hello', name: 'Hello', tools: [HelloTool] })
class HelloApp {}

@FrontMcp({
  info: { name: 'dev-e2e', version: '1.0.0' },
  apps: [HelloApp],
  logging: { level: LogLevel.Warn },${options.http ? `\n  http: ${options.http},` : ''}
})
export default class Server {}
`,
  };
}

export function helloToolSource(greeting: string): string {
  return `import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'hello', description: 'Say hello', inputSchema: { name: z.string() } })
export default class HelloTool extends ToolContext {
  async execute(input: { name: string }) {
    return \`${greeting}, \${input.name}!\`;
  }
}
`;
}

/** An unused TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

/** True while something accepts connections on `port`. */
export function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The parent env without `PORT`, so the CLI's own port choice is what the test sees. */
export function envWithoutPort(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', ...extra };
  delete env['PORT'];
  return env;
}

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseJsonRpc(line: string): JsonRpcMessage | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<JsonRpcMessage> | null;
    return parsed?.jsonrpc === '2.0' ? (parsed as JsonRpcMessage) : undefined;
  } catch {
    return undefined;
  }
}

/** Speaks newline-delimited JSON-RPC to `frontmcp dev --stdio`. */
export class StdioBridgeClient {
  readonly child: ChildProcess;
  readonly received: JsonRpcMessage[] = [];
  /** stdout lines that are not JSON-RPC; must stay empty. */
  readonly stdoutNoise: string[] = [];
  stderr = '';
  private buffer = '';
  private nextId = 1;
  private readonly waiters = new Map<string | number, (message: JsonRpcMessage) => void>();

  constructor(cwd: string, args: string[], env: NodeJS.ProcessEnv = envWithoutPort()) {
    this.child = spawn(process.execPath, [FRONTMCP_BIN, 'dev', '--stdio', ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr?.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()));
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        const message = parseJsonRpc(line);
        if (!message) {
          this.stdoutNoise.push(line);
          continue;
        }
        this.received.push(message);
        if (message.id !== undefined) this.waiters.get(message.id)?.(message);
      }
    });
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`no response to ${method} within ${timeoutMs}ms; stderr:\n${this.stderr}`));
      }, timeoutMs);
      this.waiters.set(id, (message) => {
        clearTimeout(timer);
        this.waiters.delete(id);
        resolve(message);
      });
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  async initialize(): Promise<JsonRpcMessage> {
    const response = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dev-stdio-e2e', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    return response;
  }

  /** Close stdin (the client went away) and wait for the bridge to exit. */
  async close(timeoutMs = 15_000): Promise<number | null> {
    if (this.child.exitCode !== null) return this.child.exitCode;
    const exited = new Promise<number | null>((resolve) => this.child.once('exit', (code) => resolve(code)));
    this.child.stdin?.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), timeoutMs);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Text of the first content block of a `tools/call` result. */
export function toolText(message: JsonRpcMessage): string | undefined {
  const content = (message.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  return content?.[0]?.text;
}
