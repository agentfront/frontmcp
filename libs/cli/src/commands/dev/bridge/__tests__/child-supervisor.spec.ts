/**
 * Child supervisor of the dev bridge (#679).
 *
 * - `--serve` spawned the entry through `npx tsx`, so the IPC channel stopped
 *   at npm and the server exited 0 during boot. The entry now runs as
 *   `node --import <tsx loader>`.
 * - The ready sentinel carries the port and MCP path the server really serves.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createChildSupervisor,
  parseReadySentinel,
  READY_SENTINEL,
  resolveChildCommand,
  resolveProjectTsxLoader,
  type ChildReadyInfo,
} from '../child-supervisor';
import type { BridgeLogger } from '../log';

function silentLog(): BridgeLogger {
  return {
    path: undefined,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    reloadEvent: jest.fn(),
    close: async () => undefined,
  };
}

describe('parseReadySentinel', () => {
  it('ignores lines without the sentinel', () => {
    expect(parseReadySentinel('listening on 3000')).toBeUndefined();
  });

  it('accepts the bare sentinel of older SDKs', () => {
    expect(parseReadySentinel(READY_SENTINEL)).toEqual({});
  });

  it('reads the port and path the server reports', () => {
    expect(parseReadySentinel(`${READY_SENTINEL} {"port":3155,"path":"/decorated"}`)).toEqual({
      port: 3155,
      path: '/decorated',
    });
    expect(parseReadySentinel(`${READY_SENTINEL} {"path":""}`)).toEqual({ path: '/' });
  });

  it('drops malformed payloads and values', () => {
    expect(parseReadySentinel(`${READY_SENTINEL} {nope`)).toEqual({});
    expect(parseReadySentinel(`${READY_SENTINEL} {"port":-1,"path":7}`)).toEqual({});
  });
});

describe('resolveChildCommand', () => {
  const loader = 'file:///proj/node_modules/tsx/dist/loader.mjs';

  it('runs a TypeScript entry with the tsx loader in the server process itself', () => {
    expect(resolveChildCommand('/proj/src/main.ts', 'pipe', () => loader)).toEqual({
      command: process.execPath,
      args: ['--conditions', 'node', '--import', loader, '/proj/src/main.ts'],
    });
  });

  it('runs a JavaScript entry with plain node', () => {
    expect(resolveChildCommand('/proj/dist/main.js', 'http', () => undefined)).toEqual({
      command: process.execPath,
      args: ['--conditions', 'node', '/proj/dist/main.js'],
    });
  });

  it('falls back to npx tsx in HTTP mode when the project has no tsx', () => {
    expect(resolveChildCommand('/proj/src/main.ts', 'http', () => undefined, 'linux')).toEqual({
      command: 'npx',
      args: ['-y', 'tsx', '--conditions', 'node', '/proj/src/main.ts'],
    });
    expect(resolveChildCommand('/proj/src/main.ts', 'http', () => undefined, 'win32').command).toBe('npx.cmd');
  });

  it('refuses --serve without tsx: the IPC channel cannot cross npx', () => {
    expect(() => resolveChildCommand('/proj/src/main.ts', 'pipe', () => undefined)).toThrow(/npm i -D tsx/);
  });
});

describe('resolveProjectTsxLoader', () => {
  it('resolves tsx as a file: URL', () => {
    expect(resolveProjectTsxLoader(process.cwd())).toMatch(/^file:.*tsx/);
  });
});

describe('createChildSupervisor (real child processes)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-supervisor-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('HTTP mode: ready on the sentinel, with the port and path the child reports', async () => {
    const entry = path.join(dir, 'server.js');
    fs.writeFileSync(
      entry,
      `process.stderr.write('${READY_SENTINEL} ' + JSON.stringify({ port: Number(process.env.PORT) + 1, path: '/mcp' }) + '\\n');
setInterval(() => {}, 1000);\n`,
    );
    const ready: ChildReadyInfo[] = [];
    const supervisor = createChildSupervisor({
      mode: 'http',
      entry,
      log: silentLog(),
      port: 40123,
      env: { ...process.env },
      onReady: (_child, info) => void ready.push(info),
      onExit: jest.fn(),
    });
    try {
      await supervisor.start();
      expect(ready).toEqual([{ port: 40124, path: '/mcp' }]);
    } finally {
      await supervisor.stop();
    }
    expect(supervisor.current()).toBeUndefined();
  }, 20_000);

  it('pipe mode: the server process itself owns the IPC channel', async () => {
    const entry = path.join(dir, 'server.js');
    fs.writeFileSync(
      entry,
      `if (process.env.FRONTMCP_DEV_STDIO_FD !== '3' || process.env.FRONTMCP_STDIO !== '1') process.exit(3);
process.send({ __frontmcp: 'ready' });
process.on('message', (m) => process.send({ jsonrpc: '2.0', id: m.id, result: 'pong' }));\n`,
    );
    const onReady = jest.fn();
    const supervisor = createChildSupervisor({ mode: 'pipe', entry, log: silentLog(), onReady, onExit: jest.fn() });
    try {
      await supervisor.start();
      expect(onReady).toHaveBeenCalledTimes(1);
      const child = supervisor.current();
      const reply = await new Promise<unknown>((resolve) => {
        child?.once('message', resolve);
        child?.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      });
      expect(reply).toEqual({ jsonrpc: '2.0', id: 1, result: 'pong' });
    } finally {
      await supervisor.stop();
    }
  }, 20_000);

  it('rejects start when the child exits during boot', async () => {
    const entry = path.join(dir, 'crash.js');
    fs.writeFileSync(entry, 'process.exit(2);\n');
    const supervisor = createChildSupervisor({
      mode: 'pipe',
      entry,
      log: silentLog(),
      onReady: jest.fn(),
      onExit: jest.fn(),
    });
    await expect(supervisor.start()).rejects.toThrow('child exited during boot: code=2');
  }, 20_000);

  it('restart replaces the child', async () => {
    const entry = path.join(dir, 'server.js');
    fs.writeFileSync(entry, `process.send({ __frontmcp: 'ready' });\nsetInterval(() => {}, 1000);\n`);
    const pids: Array<number | undefined> = [];
    const onExit = jest.fn();
    const supervisor = createChildSupervisor({
      mode: 'pipe',
      entry,
      log: silentLog(),
      onReady: (child) => void pids.push(child.pid),
      onExit,
    });
    try {
      await supervisor.start();
      await supervisor.restart();
      expect(pids).toHaveLength(2);
      expect(pids[0]).not.toBe(pids[1]);
      expect(onExit).toHaveBeenCalledWith('killed-for-restart');
    } finally {
      await supervisor.stop();
    }
  }, 20_000);
});
