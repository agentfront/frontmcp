/**
 * Process-tree shutdown for `frontmcp dev` children (#679).
 *
 * `kill <frontmcp dev pid>` used to leave the server listening: the process
 * holding the port is a grandchild (npm → tsx → node) and only the direct child
 * was signalled.
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

  it('ends the tree with taskkill on Windows', () => {
    const killWindowsTree = jest.fn();
    expect(signalProcessTree(fakeChild(77), 'SIGINT', { platform: 'win32', killWindowsTree })).toBe(true);
    expect(killWindowsTree).toHaveBeenCalledWith(77);
    expect(signalProcessTree(fakeChild(77, true), 'SIGINT', { platform: 'win32', killWindowsTree })).toBe(false);
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

  it('uses the child exit state on Windows', () => {
    expect(isProcessTreeAlive(fakeChild(9), { platform: 'win32' })).toBe(true);
    expect(isProcessTreeAlive(fakeChild(9, true), { platform: 'win32' })).toBe(false);
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
    await expect(stopProcessTree(fakeChild(5), 'SIGTERM', 1000, { platform: 'linux', kill, sleep })).resolves.toBe(true);
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
