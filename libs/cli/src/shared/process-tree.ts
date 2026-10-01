/**
 * Process-tree lifecycle for the long-lived children `frontmcp dev` spawns.
 *
 * The process that actually holds the dev server's port is never our direct
 * child: `npx tsx --watch main.ts` runs npm → tsx → node, and `tsx --watch`
 * forks the server once more. Signalling only the direct child (npm) let it
 * exit while the server kept listening — `kill <frontmcp dev pid>` exited 0 and
 * left the port bound (#679). Ctrl+C worked only because the terminal signals
 * the whole foreground process group.
 *
 * On POSIX every child is therefore started as the leader of its own process
 * group and shutdown signals the whole group, whoever sits in the middle. On
 * Windows (no process groups) `taskkill /T` ends the tree.
 */

import { spawnSync, type ChildProcess, type SpawnOptions } from 'child_process';

export interface ProcessTreeDeps {
  platform: NodeJS.Platform;
  /** `process.kill` — injectable for tests. */
  kill: (pid: number, signal: NodeJS.Signals | 0) => boolean | void;
  /** Ends a process tree on Windows. */
  killWindowsTree: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: ProcessTreeDeps = {
  platform: process.platform,
  kill: (pid, signal) => process.kill(pid, signal),
  killWindowsTree: (pid) => {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function withDefaults(deps?: Partial<ProcessTreeDeps>): ProcessTreeDeps {
  return { ...defaultDeps, ...deps };
}

/**
 * Spawn options that make the child the leader of a new process group (POSIX),
 * so {@link signalProcessTree} can reach every process it starts. Children in
 * their own group no longer receive the terminal's Ctrl+C directly — the parent
 * must forward the signal, which `frontmcp dev` does.
 */
export function processTreeSpawnOptions(platform: NodeJS.Platform = process.platform): Pick<SpawnOptions, 'detached'> {
  return platform === 'win32' ? {} : { detached: true };
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Send `signal` to `child` and every process it started. Returns `false` when
 * nothing was left to signal.
 */
export function signalProcessTree(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
  deps?: Partial<ProcessTreeDeps>,
): boolean {
  const d = withDefaults(deps);
  const pid = child?.pid;
  if (!child || pid === undefined) return false;

  if (d.platform === 'win32') {
    if (hasExited(child)) return false;
    try {
      d.killWindowsTree(pid);
      return true;
    } catch {
      return false;
    }
  }

  // The group outlives its leader: npm may already be gone while the server it
  // started is still running, so signal the group even when `child` has exited.
  try {
    d.kill(-pid, signal);
    return true;
  } catch {
    // ESRCH: the group is gone. Fall back to the child itself in case it was
    // not spawned as a group leader.
  }
  if (hasExited(child)) return false;
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

/** True while any process of the child's tree is still running. */
export function isProcessTreeAlive(child: ChildProcess | undefined, deps?: Partial<ProcessTreeDeps>): boolean {
  const d = withDefaults(deps);
  const pid = child?.pid;
  if (!child || pid === undefined) return false;
  if (d.platform === 'win32') return !hasExited(child);
  try {
    d.kill(-pid, 0);
    return true;
  } catch (err) {
    // EPERM means the group exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Signal the tree and wait until every process in it has exited. After
 * `graceMs` the tree is sent `SIGKILL`; resolves `true` when the tree is gone.
 */
export async function stopProcessTree(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
  graceMs: number,
  deps?: Partial<ProcessTreeDeps>,
): Promise<boolean> {
  const d = withDefaults(deps);
  if (!child) return true;
  signalProcessTree(child, signal, d);
  if (await waitForProcessTreeExit(child, graceMs, d)) return true;
  signalProcessTree(child, 'SIGKILL', d);
  return waitForProcessTreeExit(child, 1000, d);
}

async function waitForProcessTreeExit(child: ChildProcess, timeoutMs: number, d: ProcessTreeDeps): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessTreeAlive(child, d)) {
    if (Date.now() >= deadline) return false;
    await d.sleep(50);
  }
  return true;
}
