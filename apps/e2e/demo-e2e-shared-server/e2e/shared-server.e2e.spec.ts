/**
 * E2E: stdio sessions of one key share one local server process, started by whichever session finds none. A process
 * that takes the port of a server that stopped never receives a request or the token, neither from a session still
 * attached nor from a new one, which starts a server of its own.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { deriveSharedServerKeys } from '@frontmcp/auth';

import { StdioJsonRpcProcess, type JsonRpcMessage } from '../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';

const projectRoot = path.join(__dirname, '..');
const ATTACH_TIMEOUT_MS = 90_000;
const IDENTIFY_PATH = '/.well-known/frontmcp-shared-server';

interface ServerRecord {
  transport: 'unix' | 'http';
  port?: number;
  path: string;
  pid: number;
  secret: string;
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function initialize(id: number): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shared-e2e', version: '1.0.0' } },
  };
}

/** Initialize the session and ask its server for its pid. */
async function serverPidOf(session: StdioJsonRpcProcess): Promise<number> {
  const initialized = await session.request(initialize(1), ATTACH_TIMEOUT_MS);
  expect(initialized.error).toBeUndefined();
  session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return callServerPid(session, 2);
}

async function callServerPid(session: StdioJsonRpcProcess, id: number): Promise<number> {
  const answer = await session.request(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'server_pid', arguments: {} } },
    ATTACH_TIMEOUT_MS,
  );
  expect(answer.error).toBeUndefined();
  const result = answer.result as { structuredContent?: { pid: number }; content?: Array<{ text: string }> };
  return result.structuredContent?.pid ?? (JSON.parse(result.content?.[0]?.text ?? '{}') as { pid: number }).pid;
}

describe('a shared local server', () => {
  let home: string;
  let sessions: StdioJsonRpcProcess[];
  const serverPids = new Set<number>();

  function keyDirectory(): string {
    return path.join(home, 'shared', 'e2e');
  }

  function readRecord(): ServerRecord {
    const record = JSON.parse(fs.readFileSync(path.join(keyDirectory(), 'server.json'), 'utf8')) as ServerRecord;
    serverPids.add(record.pid);
    return record;
  }

  function startSession(transport: 'unix' | 'http', env: Record<string, string> = {}): StdioJsonRpcProcess {
    const session = StdioJsonRpcProcess.start('fixture/shared-session.ts', projectRoot, {
      FRONTMCP_HOME: home,
      SHARED_TRANSPORT: transport,
      ...env,
    });
    sessions.push(session);
    return session;
  }

  /** The pids of the server processes the sessions started, each written as it starts. */
  function startedServers(file: string): number[] {
    if (!fs.existsSync(file)) return [];
    const pids = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);
    for (const pid of pids) serverPids.add(pid);
    return pids;
  }

  /** Every log line any of the processes wrote. */
  function logs(): string {
    const directory = path.join(home, 'logs');
    if (!fs.existsSync(directory)) return '';
    return fs
      .readdirSync(directory)
      .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
      .join('\n');
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-e2e-'));
    sessions = [];
  });

  afterEach(async () => {
    await Promise.all(sessions.map((session) => session.stop()));
    for (const pid of serverPids) if (running(pid)) process.kill(pid, 'SIGKILL');
    serverPids.clear();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it.each(['unix', 'http'] as const)(
    'serves two stdio sessions started together from one server process (%s)',
    async (transport) => {
      const first = startSession(transport);
      const second = startSession(transport);

      const [firstServer, secondServer] = await Promise.all([serverPidOf(first), serverPidOf(second)]);

      expect(firstServer).toBe(secondServer);
      expect([first.pid, second.pid]).not.toContain(firstServer);
      const record = readRecord();
      expect(record).toMatchObject({ transport, pid: firstServer });
      expect(fs.statSync(keyDirectory()).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(keyDirectory(), 'server.json')).mode & 0o777).toBe(0o600);
      if (transport === 'unix') expect(fs.statSync(path.join(keyDirectory(), 'server.sock')).mode & 0o777).toBe(0o600);

      expect(await first.closeStdin()).toBe(0);
      expect(await callServerPid(second, 3)).toBe(firstServer);

      const { token } = deriveSharedServerKeys(record.secret);
      const written = logs();
      expect(written).toContain('shared-e2e');
      expect(written).not.toContain(token);
      expect(written).not.toContain(record.secret);
    },
    240_000,
  );

  it('keeps one server when the session that started it dies while the server is slow to start', async () => {
    const pidsFile = path.join(home, 'server-pids');
    const slow = { SHARED_BOOT_DELAY_MS: '14000', SHARED_SERVER_PIDS: pidsFile };
    const first = startSession('http', slow);
    await waitUntil(() => startedServers(pidsFile).length > 0, 30_000, 'the first session to start a server');
    const [starting] = startedServers(pidsFile);
    await first.kill();
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    expect(fs.existsSync(path.join(keyDirectory(), 'server.json'))).toBe(false);

    const second = startSession('http', slow);

    expect(await serverPidOf(second)).toBe(starting);
    expect(startedServers(pidsFile)).toEqual([starting]);
  }, 240_000);

  it('refuses to serve an app with auth of its own, which its token would not guard', async () => {
    const session = startSession('http', { SHARED_PUBLIC_APP: '1' });

    const answer = await session.request(initialize(1), ATTACH_TIMEOUT_MS);

    expect(answer.error).toMatchObject({
      message: 'dev_reload_deadline',
      data: { error: 'The shared server "e2e" did not start: it exited with code 1' },
    });
    expect(fs.existsSync(path.join(keyDirectory(), 'server.json'))).toBe(false);
  }, 240_000);

  it('never sends a request or the token to a squatter on the endpoint of a server that stopped', async () => {
    const first = startSession('http');
    const firstServer = await serverPidOf(first);
    const record = readRecord();
    const { token } = deriveSharedServerKeys(record.secret);
    process.kill(firstServer, 'SIGKILL');
    await waitUntil(() => !running(firstServer), 10_000, 'the first server to die');

    const seen: Array<{ path: string; headers: http.IncomingHttpHeaders; body: string }> = [];
    const squatter = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ path: req.url ?? '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === IDENTIFY_PATH) res.end(JSON.stringify({ proof: 'A'.repeat(43) }));
        else res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      squatter.once('error', reject);
      squatter.listen(record.port, '127.0.0.1', () => resolve());
    });
    try {
      const stale = await first.request(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'server_pid', arguments: {} } },
        ATTACH_TIMEOUT_MS,
      );
      expect(stale.error?.message).toBe('dev_server_unreachable');

      const second = startSession('http');
      const secondServer = await serverPidOf(second);

      expect(secondServer).not.toBe(firstServer);
      expect(readRecord().port).not.toBe(record.port);
      expect(seen.length).toBeGreaterThan(0);
      for (const request of seen) {
        expect(request.path).toBe(IDENTIFY_PATH);
        expect(request.headers['authorization']).toBeUndefined();
        expect(JSON.stringify(request)).not.toContain(token);
        expect(JSON.stringify(request)).not.toContain(record.secret);
      }
    } finally {
      await new Promise<void>((resolve) => {
        squatter.closeAllConnections();
        squatter.close(() => resolve());
      });
    }
  }, 240_000);
});
