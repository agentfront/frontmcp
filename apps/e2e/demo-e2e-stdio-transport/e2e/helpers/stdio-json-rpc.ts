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

  /** Run the entrypoint in this process's node, so a signal reaches the server itself and not a launcher shell. */
  static start(entrypointPath: string, cwd: string, env: Record<string, string> = {}): StdioJsonRpcProcess {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypointPath], {
      cwd,
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    return new StdioJsonRpcProcess(child);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  send(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(message: JsonRpcMessage, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<JsonRpcMessage> {
    this.send(message);
    return this.waitFor((received) => received.id === message.id && (!!received.result || !!received.error), timeoutMs);
  }

  async waitFor(match: (message: JsonRpcMessage) => boolean, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<JsonRpcMessage> {
    const deadline = Date.now() + timeoutMs;
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

  private hasExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  /** Send SIGTERM, leaving stdin open, and resolve with the exit code. */
  async terminate(): Promise<number | null> {
    if (this.hasExited()) return this.child.exitCode;
    const exited = new Promise<number | null>((resolve) => this.child.once('exit', (code) => resolve(code)));
    this.child.kill('SIGTERM');
    return exited;
  }

  /** End stdin, leaving the process unsignalled, and resolve with the exit code. */
  async closeStdin(): Promise<number | null> {
    if (this.hasExited()) return this.child.exitCode;
    const exited = new Promise<number | null>((resolve) => this.child.once('exit', (code) => resolve(code)));
    this.child.stdin.end();
    return exited;
  }

  /** Kill the process outright, leaving stdin open. */
  async kill(): Promise<void> {
    if (this.hasExited()) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.kill('SIGKILL');
    await exited;
  }

  async stop(): Promise<void> {
    if (this.hasExited()) {
      this.child.stdin.destroy();
      return;
    }
    const exited = new Promise((resolve) => this.child.once('close', resolve));
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await exited;
  }
}
