import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { StdioJsonRpcProcess, type JsonRpcMessage } from '../../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';

export const ATTACH_TIMEOUT_MS = 90_000;
const projectRoot = path.join(__dirname, '..', '..');

export interface ServerRecord {
  transport: 'unix' | 'http';
  port?: number;
  path: string;
  pid: number;
  secret: string;
}

export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll `condition` until it holds, failing past `timeoutMs`: load-tolerant, unlike a fixed sleep. */
export async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function initialize(id: number): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shared-e2e', version: '1.0.0' } },
  };
}

export async function callServerPid(session: StdioJsonRpcProcess, id: number): Promise<number> {
  const answer = await session.request(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'server_pid', arguments: {} } },
    ATTACH_TIMEOUT_MS,
  );
  expect(answer.error).toBeUndefined();
  const result = answer.result as { structuredContent?: { pid: number }; content?: Array<{ text: string }> };
  return result.structuredContent?.pid ?? (JSON.parse(result.content?.[0]?.text ?? '{}') as { pid: number }).pid;
}

/** Initialize the session and ask its server for its pid. */
export async function serverPidOf(session: StdioJsonRpcProcess): Promise<number> {
  const initialized = await session.request(initialize(1), ATTACH_TIMEOUT_MS);
  expect(initialized.error).toBeUndefined();
  session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return callServerPid(session, 2);
}

/** Stdio sessions of the fixture under a fresh `FRONTMCP_HOME`, and every server they start, all killed by `cleanup()`. */
export class SharedSessions {
  readonly home = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-e2e-'));
  readonly serverPids = new Set<number>();
  private readonly sessions: StdioJsonRpcProcess[] = [];
  private readonly pidsFile = path.join(this.home, 'server-pids');

  get keyDirectory(): string {
    return path.join(this.home, 'shared', 'e2e');
  }

  get recordFile(): string {
    return path.join(this.keyDirectory, 'server.json');
  }

  get socketPath(): string {
    return path.join(this.keyDirectory, 'server.sock');
  }

  start(transport: 'unix' | 'http', env: Record<string, string> = {}): StdioJsonRpcProcess {
    const session = StdioJsonRpcProcess.start('fixture/shared-session.ts', projectRoot, {
      FRONTMCP_HOME: this.home,
      SHARED_TRANSPORT: transport,
      SHARED_SERVER_PIDS: this.pidsFile,
      ...env,
    });
    this.sessions.push(session);
    return session;
  }

  readRecord(): ServerRecord {
    const record = JSON.parse(fs.readFileSync(this.recordFile, 'utf8')) as ServerRecord;
    this.serverPids.add(record.pid);
    return record;
  }

  /** The pids of the server processes the sessions started, each written as it starts. */
  startedServers(): number[] {
    if (!fs.existsSync(this.pidsFile)) return [];
    const pids = fs.readFileSync(this.pidsFile, 'utf8').split('\n').filter(Boolean).map(Number);
    for (const pid of pids) this.serverPids.add(pid);
    return pids;
  }

  /** Every log line any of the processes wrote. */
  logs(): string {
    const directory = path.join(this.home, 'logs');
    if (!fs.existsSync(directory)) return '';
    return fs
      .readdirSync(directory)
      .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
      .join('\n');
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.sessions.map((session) => session.stop()));
    this.startedServers();
    for (const pid of this.serverPids) if (running(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(this.home, { recursive: true, force: true });
  }
}
