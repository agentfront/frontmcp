/**
 * Process-tree lifecycle for the long-lived children `frontmcp dev` spawns.
 *
 * The process that actually holds the dev server's port is not always our
 * direct child: `tsx --watch main.ts` forks the server, and the `npx` fallback
 * puts npm in between as well. Signalling only the direct child let it exit
 * while the server kept listening — `kill <frontmcp dev pid>` exited 0 and left
 * the port bound (#679). Ctrl+C worked only because the terminal signals the
 * whole foreground process group.
 *
 * On POSIX every child is therefore started as the leader of its own process
 * group and shutdown signals the whole group, whoever sits in the middle.
 *
 * Windows has no process groups (#731). `taskkill /T` ends a tree, but only
 * while its root is alive — it walks parent links down from the root. So:
 *   - a stop first asks the tree to close (`taskkill /T`, no `/F`), and forces
 *     it (`/T /F`) when taskkill reports failure or the grace period runs out.
 *     A windowless console process (node) usually only stops when forced;
 *     checking taskkill's exit status makes that escalation immediate;
 *   - when the direct child has already exited, the processes it started are
 *     found by their parent PID (`Get-CimInstance Win32_Process`) and ended one
 *     tree at a time, and the tree only counts as gone once none is left.
 * Spawning tools directly with `process.execPath` (see `tool-command.ts`)
 * removes the `cmd.exe` shim from the tree, so a dying parent's kill-on-close
 * job object (libuv puts every non-detached child in one) takes its children
 * with it; the lookup above covers what is left.
 */

import { spawnSync, type ChildProcess, type SpawnOptions } from 'child_process';

export interface ProcessTreeDeps {
  platform: NodeJS.Platform;
  /** `process.kill` — injectable for tests. */
  kill: (pid: number, signal: NodeJS.Signals | 0) => boolean | void;
  /**
   * Runs `taskkill /pid <pid> /T` (plus `/F` when `force`) on Windows. Returns
   * `true` only when taskkill reported success.
   */
  taskkill: (pid: number, force: boolean) => boolean;
  /** PIDs of the running processes whose parent PID is `pid` (Windows). */
  childPids: (pid: number) => number[];
  sleep: (ms: number) => Promise<void>;
}

/** Runs taskkill and reports whether it succeeded — `spawnSync` itself never throws. */
export function runTaskkill(pid: number, force: boolean): boolean {
  const result = spawnSync('taskkill', ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

/** Child PIDs of `pid` from `Get-CimInstance Win32_Process`; `[]` when the lookup fails. */
export function queryChildPids(pid: number): number[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
  );
  if (result.error || result.status !== 0) return [];
  return parsePidList(String(result.stdout ?? ''));
}

/** One PID per line; anything else is ignored. */
export function parsePidList(output: string): number[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number)
    .filter((pid) => pid > 0);
}

const defaultDeps: ProcessTreeDeps = {
  platform: process.platform,
  kill: (pid, signal) => process.kill(pid, signal),
  taskkill: runTaskkill,
  childPids: queryChildPids,
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

function isPidRunning(pid: number, d: ProcessTreeDeps): boolean {
  try {
    d.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Processes the exited child started that are still running (Windows). Empty
 * when the child's PID is running again: Windows reused it, so processes
 * naming it as their parent may not be ours.
 */
function windowsOrphans(pid: number, d: ProcessTreeDeps): number[] {
  if (isPidRunning(pid, d)) return [];
  return d.childPids(pid);
}

/**
 * `taskkill /T` the child's tree. While the child runs that one call covers the
 * tree; once it has exited, each orphan it left is the root of its own call.
 * Returns whether any taskkill succeeded.
 */
function taskkillTree(child: ChildProcess, pid: number, force: boolean, d: ProcessTreeDeps): boolean {
  const roots = hasExited(child) ? windowsOrphans(pid, d) : [pid];
  let delivered = false;
  for (const root of roots) {
    if (d.taskkill(root, force)) delivered = true;
  }
  return delivered;
}

/**
 * Send `signal` to `child` and every process it started. Returns `false` when
 * nothing was left to signal (or, on Windows, when taskkill failed).
 *
 * On Windows `SIGKILL` forces the tree down (`taskkill /T /F`); any other
 * signal asks it to close (`taskkill /T`).
 */
export function signalProcessTree(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
  deps?: Partial<ProcessTreeDeps>,
): boolean {
  const d = withDefaults(deps);
  const pid = child?.pid;
  if (!child || pid === undefined) return false;

  if (d.platform === 'win32') return taskkillTree(child, pid, signal === 'SIGKILL', d);

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

/**
 * True while any process of the child's tree is still running. On Windows an
 * exited child still counts as alive while a process it started runs.
 */
export function isProcessTreeAlive(child: ChildProcess | undefined, deps?: Partial<ProcessTreeDeps>): boolean {
  const d = withDefaults(deps);
  const pid = child?.pid;
  if (!child || pid === undefined) return false;
  if (d.platform === 'win32') return !hasExited(child) || windowsOrphans(pid, d).length > 0;
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
 * `graceMs` the tree is killed (`SIGKILL`, or `taskkill /T /F` on Windows);
 * resolves `true` when the tree is gone.
 */
export async function stopProcessTree(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
  graceMs: number,
  deps?: Partial<ProcessTreeDeps>,
): Promise<boolean> {
  const d = withDefaults(deps);
  if (!child) return true;
  if (d.platform === 'win32') return stopWindowsTree(child, signal, graceMs, d);
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

async function stopWindowsTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  graceMs: number,
  d: ProcessTreeDeps,
): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) return true;
  // An exited child that left nothing running: done, without further lookups.
  if (hasExited(child) && windowsOrphans(pid, d).length === 0) return true;
  // Ask first. When taskkill reports failure — typically "can only be
  // terminated forcefully" — waiting out the grace period gains nothing.
  if (signal !== 'SIGKILL') {
    const asked = taskkillTree(child, pid, false, d);
    if (asked && (await waitForWindowsTreeExit(child, pid, graceMs, d))) return true;
  }
  const rootWasRunning = !hasExited(child);
  const forced = taskkillTree(child, pid, true, d);
  // `/T /F` on a running root ends the whole tree in one call: only the root's
  // exit is left to wait for.
  return waitForWindowsTreeExit(child, pid, 1000, d, !(forced && rootWasRunning));
}

/**
 * Wait for the child to exit (cheap: its exit state), then — unless the whole
 * tree is known gone — for the processes it left behind (one PowerShell
 * lookup per poll, so the poll is slower).
 */
async function waitForWindowsTreeExit(
  child: ChildProcess,
  pid: number,
  timeoutMs: number,
  d: ProcessTreeDeps,
  checkOrphans = true,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!hasExited(child)) {
    if (Date.now() >= deadline) return false;
    await d.sleep(50);
  }
  if (!checkOrphans) return true;
  for (;;) {
    if (windowsOrphans(pid, d).length === 0) return true;
    if (Date.now() >= deadline) return false;
    await d.sleep(250);
  }
}
