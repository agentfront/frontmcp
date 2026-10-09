/**
 * The Windows process-tree defaults (#731), driven through a mocked
 * `process.platform` and `child_process.spawnSync`: what taskkill and the
 * PowerShell child lookup are asked to do, and how their results are read.
 */
import type { ChildProcess, SpawnSyncReturns } from 'child_process';
import { EventEmitter } from 'events';

const spawnSyncMock = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

type ProcessTree = typeof import('../process-tree');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

/** Load process-tree with `process.platform` reporting Windows, so its defaults are the Windows ones. */
function loadOnWindows(): ProcessTree {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  let mod: ProcessTree | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<ProcessTree>('../process-tree');
  });
  if (!mod) throw new Error('process-tree did not load');
  return mod;
}

function result(status: number | null, stdout = '', error?: Error): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr: '', status, signal: null, error };
}

function fakeChild(pid: number, exited = false): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid, exitCode: exited ? 0 : null, signalCode: null, kill: jest.fn(() => true) });
  return child;
}

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  spawnSyncMock.mockReset();
  jest.restoreAllMocks();
});

describe('runTaskkill', () => {
  it('asks the tree to close without /F, and forces it with /F', () => {
    const { runTaskkill } = loadOnWindows();
    spawnSyncMock.mockReturnValue(result(0));
    expect(runTaskkill(42, false)).toBe(true);
    expect(spawnSyncMock).toHaveBeenLastCalledWith('taskkill', ['/pid', '42', '/T'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(runTaskkill(42, true)).toBe(true);
    expect(spawnSyncMock.mock.calls[1][1]).toEqual(['/pid', '42', '/T', '/F']);
  });

  it('reads a non-zero status or a spawn error as failure (spawnSync never throws)', () => {
    const { runTaskkill } = loadOnWindows();
    spawnSyncMock.mockReturnValueOnce(result(1));
    expect(runTaskkill(42, false)).toBe(false);
    spawnSyncMock.mockReturnValueOnce(result(null, '', new Error('spawnSync taskkill ENOENT')));
    expect(runTaskkill(42, true)).toBe(false);
  });
});

describe('queryChildPids', () => {
  it('asks Get-CimInstance for the processes whose parent is the PID', () => {
    const { queryChildPids } = loadOnWindows();
    spawnSyncMock.mockReturnValue(result(0, '1204\r\n1388\r\n'));
    expect(queryChildPids(77)).toEqual([1204, 1388]);
    const [command, args] = spawnSyncMock.mock.calls[0];
    expect(command).toBe('powershell.exe');
    expect(args).toContain('-NoProfile');
    expect(args[args.length - 1]).toContain('Get-CimInstance Win32_Process -Filter "ParentProcessId=77"');
  });

  it('returns nothing when the lookup fails or the PID is not a process id', () => {
    const { queryChildPids } = loadOnWindows();
    spawnSyncMock.mockReturnValueOnce(result(1, '5\n'));
    expect(queryChildPids(77)).toEqual([]);
    spawnSyncMock.mockReturnValueOnce(result(null, '', new Error('ENOENT')));
    expect(queryChildPids(77)).toEqual([]);
    expect(queryChildPids(0)).toEqual([]);
    expect(queryChildPids(1.5)).toEqual([]);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
  });
});

describe('parsePidList', () => {
  it('keeps positive integers, one per line', () => {
    const { parsePidList } = loadOnWindows();
    expect(parsePidList(' 12 \r\n\r\nWARNING: x\n0\n34')).toEqual([12, 34]);
  });
});

describe('stopProcessTree with the Windows defaults', () => {
  it('forces a tree taskkill cannot ask to close, without waiting out the grace period', async () => {
    const { processTreeSpawnOptions, stopProcessTree } = loadOnWindows();
    const child = fakeChild(900);
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (!args.includes('/F')) return result(1); // "can only be terminated forcefully"
      Object.assign(child, { exitCode: 1 });
      return result(0);
    });

    const started = Date.now();
    await expect(stopProcessTree(child, 'SIGTERM', 30_000)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(spawnSyncMock.mock.calls.map((call) => call[1])).toEqual([
      ['/pid', '900', '/T'],
      ['/pid', '900', '/T', '/F'],
    ]);
    // No process groups on Windows.
    expect(processTreeSpawnOptions()).toEqual({});
  });

  it('finds and stops what an exited child left running', async () => {
    const { stopProcessTree } = loadOnWindows();
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    let orphanAlive = true;
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'powershell.exe') return result(0, orphanAlive ? '4321\r\n' : '');
      if (args[1] === '4321' && args.includes('/F')) orphanAlive = false;
      return result(args.includes('/F') ? 0 : 1);
    });

    await expect(stopProcessTree(fakeChild(901, true), 'SIGINT', 2_000)).resolves.toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], expect.anything());
    expect(orphanAlive).toBe(false);
  });
});
