import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { OwnedProcessError, parseProcessList, reapOrphans, spawnOwned, type ProcessInfo } from '../owned-process';

let mockPsResult: object | undefined;

jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => mockPsResult ?? actual.spawnSync(...args),
  };
});

function esrch(): Error {
  return Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('spawnOwned', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spawn-owned-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('passes the marker and this process as owner in the environment and as the last argument', async () => {
    const out = join(directory, 'seen.json');
    const script = `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(1), owner: process.env.FRONTMCP_OWNER, kept: process.env.KEPT }))`;
    const owned = spawnOwned(process.execPath, ['-e', script, 'first'], {
      marker: 'unit-marker',
      env: { ...process.env, KEPT: 'yes' },
      stdio: 'ignore',
    });
    await new Promise((resolve) => owned.child.once('exit', resolve));

    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      argv: ['first', `--frontmcp-owner=unit-marker:${process.pid}`],
      owner: `unit-marker:${process.pid}`,
      kept: 'yes',
    });
  });

  it("stops the child's tree", async () => {
    const owned = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--'], {
      marker: 'unit-stop',
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    const pid = owned.child.pid;
    if (pid === undefined) throw new Error('no pid');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(owned.child.exitCode).toBeNull();

    await expect(owned.stop('SIGTERM', 2000)).resolves.toBe(true);
    expect(running(pid)).toBe(false);
  });

  it('stops a child that shares this process group, killing it when it ignores SIGTERM', async () => {
    const script = 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000)';
    const owned = spawnOwned(process.execPath, ['-e', script, '--'], {
      marker: 'unit-stop-child',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((resolve) => owned.child.stdout?.once('data', resolve));

    try {
      await expect(owned.stop('SIGTERM', 200)).resolves.toBe(true);

      expect(owned.child.signalCode).toBe('SIGKILL');
      await expect(owned.stop()).resolves.toBe(true);
    } finally {
      owned.child.kill('SIGKILL');
    }
  });

  it('has nothing to stop when the command could not start', async () => {
    const owned = spawnOwned(join(directory, 'missing-command'), [], { marker: 'unit-missing', stdio: 'ignore' });
    const failed = new Promise((resolve) => owned.child.once('error', resolve));

    await expect(owned.stop()).resolves.toBe(true);
    await failed;
  });

  it.each(['', 'has space', 'a:b', '-leading', 'x'.repeat(65)])('refuses the marker %p', (marker) => {
    expect(() => spawnOwned(process.execPath, [], { marker })).toThrow(OwnedProcessError);
  });
});

describe('parseProcessList', () => {
  it('reads pid, parent pid, group, zombie state and command, skipping lines it cannot read', () => {
    const output =
      '    1     0     1 Ss   /sbin/launchd\n  812   1  812 S node worker.js --frontmcp-owner=a:9 x\n  813   1  1 Z+ [node] <defunct>\nbogus\n\n';
    expect(parseProcessList(output)).toEqual<ProcessInfo[]>([
      { pid: 1, ppid: 0, pgid: 1, zombie: false, command: '/sbin/launchd' },
      { pid: 812, ppid: 1, pgid: 812, zombie: false, command: 'node worker.js --frontmcp-owner=a:9 x' },
      { pid: 813, ppid: 1, pgid: 1, zombie: true, command: '[node] <defunct>' },
    ]);
  });
});

describe('reapOrphans', () => {
  const sleep = jest.fn(async () => undefined);

  function scenario(processes: ProcessInfo[], aliveOwners: number[]) {
    const alive = new Set([...processes.map((info) => info.pid), ...aliveOwners]);
    const signals: Array<[number, NodeJS.Signals | 0]> = [];
    const kill = jest.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (!alive.has(pid)) throw esrch();
        return;
      }
      signals.push([pid, signal]);
      alive.delete(pid);
    });
    return { kill, signals, alive, deps: { platform: 'linux' as const, kill, sleep, listProcesses: () => processes } };
  }

  it('stops a marked process whose owner is gone, with its descendants and its group', async () => {
    const { deps, signals } = scenario(
      [
        { pid: 100, ppid: 1, pgid: 100, zombie: false, command: 'node worker.js --frontmcp-owner=tasks:50' },
        { pid: 101, ppid: 100, pgid: 100, zombie: false, command: 'node child.js' },
        { pid: 102, ppid: 101, pgid: 100, zombie: false, command: 'node grandchild.js' },
        { pid: 103, ppid: 1, pgid: 100, zombie: false, command: 'node left-in-group.js' },
        { pid: 200, ppid: 1, pgid: 200, zombie: false, command: 'node unmarked.js' },
      ],
      [],
    );

    await expect(reapOrphans('tasks', {}, deps)).resolves.toEqual([100]);

    expect(signals.map(([pid]) => pid).sort()).toEqual([100, 101, 102, 103]);
    expect(signals.every(([, signal]) => signal === 'SIGTERM')).toBe(true);
  });

  it('leaves processes whose owner still runs, other markers and this process alone', async () => {
    const { deps, signals } = scenario(
      [
        { pid: 300, ppid: 60, pgid: 300, zombie: false, command: 'node a.js --frontmcp-owner=tasks:60' },
        { pid: 301, ppid: 1, pgid: 301, zombie: false, command: 'node b.js --frontmcp-owner=other:61' },
        { pid: 302, ppid: 1, pgid: 302, zombie: false, command: 'node c.js --frontmcp-owner=tasks-2:62' },
        { pid: 303, ppid: 1, pgid: 303, zombie: false, command: 'node d.js --frontmcp-owner=tasks:not-a-pid' },
        {
          pid: process.pid,
          ppid: 1,
          pgid: process.pid,
          zombie: false,
          command: 'node self.js --frontmcp-owner=tasks:63',
        },
      ],
      [60],
    );

    await expect(reapOrphans('tasks', {}, deps)).resolves.toEqual([]);
    expect(signals).toEqual([]);
  });

  it('never stops this process or its ancestors, even when they carry the marker of a gone owner', async () => {
    const { deps, signals } = scenario(
      [
        {
          pid: 650,
          ppid: 1,
          pgid: 650,
          zombie: false,
          command: 'npx tsx main.ts __run-task t1 --frontmcp-owner=tasks:50',
        },
        {
          pid: 700,
          ppid: 650,
          pgid: 700,
          zombie: false,
          command: 'tsx main.ts __run-task t1 --frontmcp-owner=tasks:50',
        },
        { pid: 701, ppid: 700, pgid: 700, zombie: false, command: 'node sibling.js' },
        {
          pid: process.pid,
          ppid: 700,
          pgid: 700,
          zombie: false,
          command: 'node main.ts __run-task t1 --frontmcp-owner=tasks:50',
        },
        { pid: 900, ppid: 1, pgid: 900, zombie: false, command: 'node other.js --frontmcp-owner=tasks:50' },
      ],
      [],
    );

    await expect(reapOrphans('tasks', {}, deps)).resolves.toEqual([900]);
    expect(signals).toEqual([[900, 'SIGTERM']]);
  });

  it("leaves the leader of this process's own group alone", async () => {
    const { deps, signals } = scenario(
      [
        { pid: 800, ppid: 1, pgid: 800, zombie: false, command: 'node leader.js --frontmcp-owner=tasks:50' },
        { pid: 801, ppid: 1, pgid: 800, zombie: false, command: 'node sibling.js' },
        { pid: process.pid, ppid: 1, pgid: 800, zombie: false, command: 'node reaper.js' },
      ],
      [],
    );

    await expect(reapOrphans('tasks', {}, deps)).resolves.toEqual([]);
    expect(signals).toEqual([]);
  });

  it('treats an owner it may not signal as running', async () => {
    const kill = jest.fn((pid: number) => {
      if (pid === 70) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    });
    const listProcesses = () => [
      { pid: 400, ppid: 1, pgid: 400, zombie: false, command: 'x --frontmcp-owner=tasks:70' },
    ];
    await expect(reapOrphans('tasks', {}, { platform: 'darwin', kill, sleep, listProcesses })).resolves.toEqual([]);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('kills what outlives the grace period', async () => {
    const processes = [{ pid: 500, ppid: 1, pgid: 500, zombie: false, command: 'x --frontmcp-owner=tasks:80' }];
    let alive = true;
    const kill = jest.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (pid === 80) throw esrch();
      if (signal === 0 && !alive) throw esrch();
      if (signal === 'SIGKILL') alive = false;
    });

    await expect(
      reapOrphans('tasks', { graceMs: 0 }, { platform: 'linux', kill, sleep, listProcesses: () => processes }),
    ).resolves.toEqual([500]);
    expect(kill).toHaveBeenCalledWith(500, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(500, 'SIGKILL');
  });

  it('counts an orphan that exited but was not collected by its new parent (a zombie) as stopped', async () => {
    let exited = false;
    const kill = jest.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (pid === 95) throw esrch();
      if (signal === 'SIGTERM') exited = true;
    });
    const listProcesses = () => [
      exited
        ? { pid: 650, ppid: 1, pgid: 650, zombie: true, command: '[node] <defunct>' }
        : { pid: 650, ppid: 1, pgid: 650, zombie: false, command: 'x --frontmcp-owner=tasks:95' },
    ];

    await expect(reapOrphans('tasks', {}, { platform: 'linux', kill, sleep, listProcesses })).resolves.toEqual([650]);
    expect(kill).not.toHaveBeenCalledWith(650, 'SIGKILL');
  });

  it('does not report an orphan that survives even SIGKILL', async () => {
    const kill = jest.fn((pid: number) => {
      if (pid === 90) throw esrch();
    });
    const listProcesses = () => [
      { pid: 600, ppid: 1, pgid: 600, zombie: false, command: 'x --frontmcp-owner=tasks:90' },
    ];
    await expect(
      reapOrphans('tasks', { graceMs: 0 }, { platform: 'linux', kill, sleep, listProcesses }),
    ).resolves.toEqual([]);
  });

  it('does nothing on Windows', async () => {
    const listProcesses = jest.fn(() => []);
    await expect(reapOrphans('tasks', {}, { platform: 'win32', listProcesses })).resolves.toEqual([]);
    expect(listProcesses).not.toHaveBeenCalled();
  });

  it('refuses an invalid marker', async () => {
    await expect(reapOrphans('bad marker')).rejects.toThrow(OwnedProcessError);
  });

  (process.platform === 'win32' ? it.skip : it)(
    'finds a real orphan with ps and leaves an owned child of this process running',
    async () => {
      const marker = `unit-reap-${process.pid}`;
      const ours = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--'], {
        marker,
        detached: true,
        stdio: 'ignore',
      });
      const orphanScript = `const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', '--frontmcp-owner=${marker}:' + process.pid], { detached: true, stdio: 'ignore' });
        child.unref();
        process.stdout.write(String(child.pid));`;
      const launcher = spawn(process.execPath, ['-e', orphanScript], { stdio: ['ignore', 'pipe', 'ignore'] });
      const orphanPid = await new Promise<number>((resolve) => {
        launcher.stdout.once('data', (chunk: Buffer) => resolve(Number(chunk.toString())));
      });
      await new Promise((resolve) => launcher.once('exit', resolve));
      try {
        await waitUntil(() => running(orphanPid));

        await expect(reapOrphans(marker, { graceMs: 2000 })).resolves.toEqual([orphanPid]);

        expect(running(orphanPid)).toBe(false);
        expect(ours.child.exitCode).toBeNull();
      } finally {
        if (running(orphanPid)) process.kill(orphanPid, 'SIGKILL');
        await ours.stop('SIGKILL', 1000);
      }
    },
    20_000,
  );
});

describe('reapOrphans when ps fails', () => {
  afterEach(() => {
    mockPsResult = undefined;
  });

  it.each([
    [{ status: 1, stdout: '', stderr: 'ps: illegal option -- w\n' }, 'ps: illegal option -- w'],
    [{ status: 1, stdout: '', stderr: '' }, 'exit code 1'],
    [{ status: null, stdout: '', stderr: '', error: new Error('spawnSync ps ENOENT') }, 'spawnSync ps ENOENT'],
  ])('rejects with the reason', async (result, reason) => {
    mockPsResult = result;
    const reaping = reapOrphans('tasks', {}, { platform: 'linux' });
    await expect(reaping).rejects.toBeInstanceOf(OwnedProcessError);
    await expect(reaping).rejects.toThrow(`Could not list processes with ps: ${reason}`);
  });
});
