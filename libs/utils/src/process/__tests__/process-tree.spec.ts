/**
 * Process-tree shutdown for `frontmcp dev` children (#679).
 *
 * `kill <frontmcp dev pid>` used to leave the server listening: the process
 * holding the port is a grandchild (tsx → node, or npm → tsx → node through
 * npx) and only the direct child was signalled.
 */
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import {
  isProcessTreeAlive,
  processTreeSpawnOptions,
  signalProcessTree,
  stopProcessTree,
  type ProcessTreeDeps,
} from '../process-tree';

function fakeChild(pid: number | undefined, exited = false): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid,
    exitCode: exited ? 0 : null,
    signalCode: null,
    kill: jest.fn(() => true),
  });
  return child;
}

function esrch(): Error {
  return Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
}

describe('processTreeSpawnOptions', () => {
  it('makes the child a process-group leader on POSIX only', () => {
    expect(processTreeSpawnOptions('darwin')).toEqual({ detached: true });
    expect(processTreeSpawnOptions('linux')).toEqual({ detached: true });
    expect(processTreeSpawnOptions('win32')).toEqual({});
  });
});

describe('signalProcessTree', () => {
  it('signals the whole process group on POSIX', () => {
    const kill = jest.fn();
    const child = fakeChild(4242);
    expect(signalProcessTree(child, 'SIGTERM', { platform: 'linux', kill })).toBe(true);
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('signals the group even after the leader exited (its children may still run)', () => {
    const kill = jest.fn();
    signalProcessTree(fakeChild(4242, true), 'SIGINT', { platform: 'darwin', kill });
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGINT');
  });

  it('falls back to the child itself when there is no group', () => {
    const kill = jest.fn(() => {
      throw esrch();
    });
    const child = fakeChild(4242);
    expect(signalProcessTree(child, 'SIGTERM', { platform: 'linux', kill })).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('returns false when neither the group nor the child is left', () => {
    const kill = jest.fn(() => {
      throw esrch();
    });
    expect(signalProcessTree(fakeChild(4242, true), 'SIGTERM', { platform: 'linux', kill })).toBe(false);
    expect(signalProcessTree(fakeChild(undefined), 'SIGTERM', { platform: 'linux', kill })).toBe(false);
    expect(signalProcessTree(undefined, 'SIGTERM', { platform: 'linux', kill })).toBe(false);
  });
});

// #731 — Windows: taskkill /T, graceful before /F, and an exited child's orphans.
describe('signalProcessTree on Windows', () => {
  const notRunning = jest.fn(() => {
    throw esrch();
  });

  it('asks a running tree to close, and forces it on SIGKILL', () => {
    const taskkill = jest.fn(() => true);
    expect(signalProcessTree(fakeChild(77), 'SIGINT', { platform: 'win32', taskkill })).toBe(true);
    expect(taskkill).toHaveBeenLastCalledWith(77, false);
    expect(signalProcessTree(fakeChild(77), 'SIGKILL', { platform: 'win32', taskkill })).toBe(true);
    expect(taskkill).toHaveBeenLastCalledWith(77, true);
  });

  it('reports a failed taskkill instead of success', () => {
    const taskkill = jest.fn(() => false);
    expect(signalProcessTree(fakeChild(77), 'SIGTERM', { platform: 'win32', taskkill })).toBe(false);
  });

  it('ends the processes an exited child left running, one tree each', () => {
    const taskkill = jest.fn(() => true);
    const childPids = jest.fn(() => [101, 102]);
    const deps = { platform: 'win32' as const, taskkill, childPids, kill: notRunning };
    expect(signalProcessTree(fakeChild(77, true), 'SIGTERM', deps)).toBe(true);
    expect(childPids).toHaveBeenCalledWith(77);
    expect(taskkill.mock.calls).toEqual([
      [101, false],
      [102, false],
    ]);
  });

  it('returns false when an exited child left nothing running', () => {
    const taskkill = jest.fn(() => true);
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [], kill: notRunning };
    expect(signalProcessTree(fakeChild(77, true), 'SIGTERM', deps)).toBe(false);
    expect(taskkill).not.toHaveBeenCalled();
  });

  it('leaves processes alone when Windows reused the exited child PID', () => {
    const taskkill = jest.fn(() => true);
    const childPids = jest.fn(() => [101]);
    const deps = { platform: 'win32' as const, taskkill, childPids, kill: jest.fn() };
    expect(signalProcessTree(fakeChild(77, true), 'SIGTERM', deps)).toBe(false);
    expect(childPids).not.toHaveBeenCalled();
    expect(taskkill).not.toHaveBeenCalled();
  });
});

describe('isProcessTreeAlive', () => {
  it('probes the group with signal 0', () => {
    const kill = jest.fn();
    expect(isProcessTreeAlive(fakeChild(9), { platform: 'linux', kill })).toBe(true);
    expect(kill).toHaveBeenCalledWith(-9, 0);
  });

  it('treats EPERM as alive and ESRCH as gone', () => {
    const eperm = jest.fn(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    const gone = jest.fn(() => {
      throw esrch();
    });
    expect(isProcessTreeAlive(fakeChild(9), { platform: 'linux', kill: eperm })).toBe(true);
    expect(isProcessTreeAlive(fakeChild(9), { platform: 'linux', kill: gone })).toBe(false);
    expect(isProcessTreeAlive(undefined, { platform: 'linux', kill: gone })).toBe(false);
  });

  it('on Windows, counts an exited child alive while a process it started runs', () => {
    const kill = jest.fn(() => {
      throw esrch();
    });
    expect(isProcessTreeAlive(fakeChild(9), { platform: 'win32' })).toBe(true);
    expect(isProcessTreeAlive(fakeChild(9, true), { platform: 'win32', kill, childPids: () => [10] })).toBe(true);
    expect(isProcessTreeAlive(fakeChild(9, true), { platform: 'win32', kill, childPids: () => [] })).toBe(false);
  });
});

describe('stopProcessTree', () => {
  const sleep = jest.fn(async () => undefined);

  it('resolves once the tree is gone after the first signal', async () => {
    let alive = true;
    const kill = jest.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0 && !alive) throw esrch();
      if (signal === 'SIGTERM') alive = false;
    });
    await expect(stopProcessTree(fakeChild(5), 'SIGTERM', 1000, { platform: 'linux', kill, sleep })).resolves.toBe(
      true,
    );
    expect(kill).not.toHaveBeenCalledWith(-5, 'SIGKILL');
  });

  it('escalates to SIGKILL when the tree outlives the grace period', async () => {
    let alive = true;
    const kill = jest.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0 && !alive) throw esrch();
      if (signal === 'SIGKILL') alive = false;
    });
    const deps: Partial<ProcessTreeDeps> = { platform: 'linux', kill, sleep };
    await expect(stopProcessTree(fakeChild(5), 'SIGINT', 0, deps)).resolves.toBe(true);
    expect(kill).toHaveBeenCalledWith(-5, 'SIGINT');
    expect(kill).toHaveBeenCalledWith(-5, 'SIGKILL');
  });

  it('is a no-op without a child', async () => {
    await expect(stopProcessTree(undefined, 'SIGTERM', 10)).resolves.toBe(true);
  });
});

describe('stopProcessTree on Windows', () => {
  const sleep = jest.fn(async () => undefined);
  const notRunning = jest.fn(() => {
    throw esrch();
  });

  function exit(child: ChildProcess): void {
    Object.assign(child, { exitCode: 0 });
  }

  it('asks first and stops there when the tree closes in time', async () => {
    const child = fakeChild(31);
    const taskkill = jest.fn((_pid: number, force: boolean) => {
      if (!force) exit(child);
      return true;
    });
    const childPids = jest.fn(() => []);
    const deps = { platform: 'win32' as const, taskkill, childPids, kill: notRunning, sleep };
    await expect(stopProcessTree(child, 'SIGTERM', 1000, deps)).resolves.toBe(true);
    expect(taskkill.mock.calls).toEqual([[31, false]]);
    // A graceful close may leave processes behind: checked once the child exited.
    expect(childPids).toHaveBeenCalledWith(31);
  });

  it('forces the tree at once when taskkill cannot ask it to close', async () => {
    const child = fakeChild(32);
    const taskkill = jest.fn((_pid: number, force: boolean) => {
      if (force) exit(child);
      return force;
    });
    const childPids = jest.fn(() => []);
    const deps = { platform: 'win32' as const, taskkill, childPids, kill: notRunning, sleep };
    // A long grace period that must not be waited out.
    await expect(stopProcessTree(child, 'SIGINT', 60_000, deps)).resolves.toBe(true);
    expect(taskkill.mock.calls).toEqual([
      [32, false],
      [32, true],
    ]);
    expect(sleep).not.toHaveBeenCalledWith(250);
    // `/T /F` on a running root takes the whole tree: no orphan lookup needed.
    expect(childPids).not.toHaveBeenCalled();
  });

  it('forces the tree once the grace period runs out', async () => {
    const child = fakeChild(33);
    const taskkill = jest.fn((_pid: number, force: boolean) => {
      if (force) exit(child);
      return true;
    });
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [], kill: notRunning, sleep };
    await expect(stopProcessTree(child, 'SIGTERM', 0, deps)).resolves.toBe(true);
    expect(taskkill).toHaveBeenLastCalledWith(33, true);
  });

  it('goes straight to /F for SIGKILL', async () => {
    const child = fakeChild(34);
    const taskkill = jest.fn(() => {
      exit(child);
      return true;
    });
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [], kill: notRunning, sleep };
    await expect(stopProcessTree(child, 'SIGKILL', 1000, deps)).resolves.toBe(true);
    expect(taskkill.mock.calls).toEqual([[34, true]]);
  });

  it('is done at once when the child already exited and left nothing running', async () => {
    const taskkill = jest.fn(() => true);
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [], kill: notRunning, sleep };
    await expect(stopProcessTree(fakeChild(35, true), 'SIGTERM', 1000, deps)).resolves.toBe(true);
    expect(taskkill).not.toHaveBeenCalled();
  });

  it('stops the server an exited child left running instead of orphaning it', async () => {
    let orphans = [501];
    const taskkill = jest.fn((pid: number) => {
      orphans = orphans.filter((p) => p !== pid);
      return true;
    });
    const deps = { platform: 'win32' as const, taskkill, childPids: () => orphans, kill: notRunning, sleep };
    await expect(stopProcessTree(fakeChild(36, true), 'SIGTERM', 1000, deps)).resolves.toBe(true);
    expect(taskkill).toHaveBeenCalledWith(501, false);
  });

  it('reports false when the tree outlives both attempts', async () => {
    const taskkill = jest.fn(() => true);
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [601], kill: notRunning, sleep };
    await expect(stopProcessTree(fakeChild(37, true), 'SIGTERM', 0, deps)).resolves.toBe(false);
    expect(taskkill).toHaveBeenCalledWith(601, true);
  });

  it('reports false when a running child ignores even /F', async () => {
    const taskkill = jest.fn(() => false);
    const deps = { platform: 'win32' as const, taskkill, childPids: () => [], kill: notRunning, sleep };
    await expect(stopProcessTree(fakeChild(38), 'SIGTERM', 0, deps)).resolves.toBe(false);
  });
});

// A real tree: a group leader that forks a grandchild and then exits on its own,
// the way npm exits while the server it started keeps running.
(process.platform === 'win32' ? describe.skip : describe)('stopProcessTree with real processes', () => {
  it('stops a grandchild whose parent already exited', async () => {
    const script = `
      const { spawn } = require('child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      grandchild.unref();
      process.stdout.write(String(grandchild.pid) + '\\n');
    `;
    const leader = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    const grandchildPid = await new Promise<number>((resolve) => {
      leader.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
    });
    await new Promise((resolve) => leader.once('exit', resolve));

    const running = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(running(grandchildPid)).toBe(true);

    try {
      await expect(stopProcessTree(leader, 'SIGTERM', 2000)).resolves.toBe(true);
      expect(running(grandchildPid)).toBe(false);
    } finally {
      if (running(grandchildPid)) process.kill(grandchildPid, 'SIGKILL');
    }
  }, 15_000);
});
