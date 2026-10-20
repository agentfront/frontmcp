import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> & { _meta?: Record<string, unknown> };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

const RESPONSE_TIMEOUT_MS = 30_000;

/** A stdio MCP server process spoken to in raw newline-delimited JSON-RPC. */
export class StdioJsonRpcProcess {
  readonly stdoutLines: string[] = [];
  private readonly received: JsonRpcMessage[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      this.stdoutLines.push(line);
      try {
        this.received.push(JSON.parse(line) as JsonRpcMessage);
      } catch {
        return;
      }
      for (const wake of this.waiters) wake();
    });
  }

  static start(entrypointPath: string, cwd: string): StdioJsonRpcProcess {
    const child = spawn('npx', ['tsx', entrypointPath], {
      cwd,
      env: process.env as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    return new StdioJsonRpcProcess(child);
  }

  send(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    this.send(message);
    return this.waitFor((received) => received.id === message.id && (!!received.result || !!received.error));
  }

  async waitFor(match: (message: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    for (;;) {
      const found = this.received.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no matching message in ${JSON.stringify(this.received)}`);
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 200);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('close', resolve));
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await exited;
  }
}
