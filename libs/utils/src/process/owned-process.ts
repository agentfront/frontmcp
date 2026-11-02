/**
 * Child processes that carry their owner's mark, so the ones whose owner died can be found and stopped.
 *
 * **Node.js only.**
 */

import type { ChildProcess, SpawnOptions } from 'child_process';

import { getChildProcess } from './child-process';
import { isPidRunning, sleep, stopProcessTree, type ProcessTreeDeps } from './process-tree';

const OWNER_ENV_VAR = 'FRONTMCP_OWNER';
const OWNER_ARG_PREFIX = '--frontmcp-owner=';
const MARKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_REAP_GRACE_MS = 2000;
const KILL_WAIT_MS = 1000;

export class OwnedProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnedProcessError';
  }
}

export interface SpawnOwnedOptions extends SpawnOptions {
  /** Names the kind of process, for {@link reapOrphans}: up to 64 letters, digits, `.`, `_` and `-`. */
  marker: string;
}

export interface OwnedProcess {
  readonly child: ChildProcess;
  /** Stop the child and every process it started; resolves `true` once they are gone. */
  stop(signal?: NodeJS.Signals, graceMs?: number): Promise<boolean>;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

export interface ReapOrphansOptions {
  /** How long the orphans get to exit after `SIGTERM` before they are killed. @default 2000 */
  graceMs?: number;
}

export interface ReapOrphansDeps extends Pick<ProcessTreeDeps, 'platform' | 'kill' | 'sleep'> {
  listProcesses: () => ProcessInfo[];
}

function assertMarker(marker: string): void {
  if (!MARKER_PATTERN.test(marker)) {
    throw new OwnedProcessError(
      `Invalid process marker "${marker}": use up to 64 letters, digits, ".", "_" and "-", starting with a letter or digit`,
    );
  }
}

/**
 * Spawn `command` marked as owned by this process: the child gets `FRONTMCP_OWNER=<marker>:<owner pid>` in its
 * environment and `--frontmcp-owner=<marker>:<owner pid>` as its last argument, which {@link reapOrphans} finds
 * with `ps`. The command must take that last argument as an argument: a script run by node does, while
 * `node -e <code>` reads it as a node option unless the arguments end with `--`.
 *
 * @throws OwnedProcessError when the marker is invalid
 */
export function spawnOwned(command: string, args: readonly string[], options: SpawnOwnedOptions): OwnedProcess {
  const { marker, ...spawnOptions } = options;
  assertMarker(marker);
  const owner = `${marker}:${process.pid}`;
  const child = getChildProcess().spawn(command, [...args, `${OWNER_ARG_PREFIX}${owner}`], {
    ...spawnOptions,
    env: { ...(spawnOptions.env ?? process.env), [OWNER_ENV_VAR]: owner },
  });
  return {
    child,
    stop: (signal = 'SIGTERM', graceMs = 5000) => stopProcessTree(child, signal, graceMs),
  };
}

/** Parse `ps -o pid=,ppid=,pgid=,command=` output; lines it cannot read are skipped. */
export function parseProcessList(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match) {
      processes.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] });
    }
  }
  return processes;
}

function listProcesses(): ProcessInfo[] {
  const result = getChildProcess().spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,pgid=,command='], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? (String(result.stderr).trim() || `exit code ${result.status}`);
    throw new OwnedProcessError(`Could not list processes with ps: ${reason}`);
  }
  return parseProcessList(String(result.stdout));
}

function ownerPidOf(command: string, marker: string): number | undefined {
  const prefix = `${OWNER_ARG_PREFIX}${marker}:`;
  const tag = command.split(/\s+/).find((token) => token.startsWith(prefix));
  const pid = tag?.slice(prefix.length);
  return pid && /^\d+$/.test(pid) ? Number(pid) : undefined;
}

/** The orphans, the processes they started, and the rest of each orphan's process group. */
function treesOf(orphans: ProcessInfo[], processes: ProcessInfo[]): Set<number> {
  const members = new Set<number>();
  const pending = orphans.map((orphan) => orphan.pid);
  for (const orphan of orphans) {
    if (orphan.pgid === orphan.pid) {
      for (const info of processes) if (info.pgid === orphan.pid) pending.push(info.pid);
    }
  }
  while (pending.length > 0) {
    const pid = pending.pop() as number;
    if (members.has(pid) || pid === process.pid) continue;
    members.add(pid);
    for (const info of processes) if (info.ppid === pid) pending.push(info.pid);
  }
  return members;
}

function signalEach(pids: Iterable<number>, signal: NodeJS.Signals, d: ReapOrphansDeps): void {
  for (const pid of pids) {
    try {
      d.kill(pid, signal);
    } catch {
      // Gone already, or not ours to signal.
    }
  }
}

async function waitForExit(pids: number[], timeoutMs: number, d: ReapOrphansDeps): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let running = pids.filter((pid) => isPidRunning(pid, d));
  while (running.length > 0 && Date.now() < deadline) {
    await d.sleep(50);
    running = running.filter((pid) => isPidRunning(pid, d));
  }
  return running;
}

/**
 * Stop the processes {@link spawnOwned} marked with `marker` whose owner no longer runs, with every process they
 * started: `SIGTERM`, then `SIGKILL` for what is still running after `graceMs`. A process whose owner still runs,
 * or that carries another marker or none, is left alone. Resolves with the pids of the marked orphans it stopped.
 *
 * POSIX only: it reads the process table with `ps`. On Windows it does nothing and resolves with `[]`.
 *
 * @throws OwnedProcessError when the marker is invalid, or `ps` cannot list the processes
 */
export async function reapOrphans(
  marker: string,
  options: ReapOrphansOptions = {},
  deps?: Partial<ReapOrphansDeps>,
): Promise<number[]> {
  assertMarker(marker);
  const d: ReapOrphansDeps = {
    platform: process.platform,
    kill: (pid, signal) => process.kill(pid, signal),
    sleep,
    listProcesses,
    ...deps,
  };
  if (d.platform === 'win32') return [];

  const processes = d.listProcesses();
  const orphans = processes.filter((info) => {
    const owner = ownerPidOf(info.command, marker);
    return owner !== undefined && info.pid !== process.pid && !isPidRunning(owner, d);
  });
  if (orphans.length === 0) return [];

  const tree = [...treesOf(orphans, processes)];
  signalEach(tree, 'SIGTERM', d);
  const survivors = await waitForExit(tree, options.graceMs ?? DEFAULT_REAP_GRACE_MS, d);
  if (survivors.length > 0) {
    signalEach(survivors, 'SIGKILL', d);
    await waitForExit(survivors, KILL_WAIT_MS, d);
  }
  return orphans.map((orphan) => orphan.pid).filter((pid) => !isPidRunning(pid, d));
}
