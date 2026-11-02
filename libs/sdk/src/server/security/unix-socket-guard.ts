// A socket server has no Host or Origin to check: the socket file's permissions are its only boundary.
import cluster from 'node:cluster';
import type * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';

import { chmod, lstat, stat, unlink } from '@frontmcp/utils';

import {
  SocketInUseError,
  SocketPathConflictError,
  SocketPermissionError,
  UnsafeSocketDirectoryError,
} from '../../errors/transport.errors';

const OWNER_ONLY_MODE = 0o600;
// Clears group and other bits only: the umask is process-wide, so a directory created meanwhile stays usable.
const OWNER_ONLY_UMASK = 0o077;
const GROUP_OR_OTHER_WRITE = 0o022;
const GROUP_OR_OTHER_ACCESS = 0o077;
const STICKY_BIT = 0o1000;
const ROOT_UID = 0;

/** A win32 socket path names a named pipe, which has no file mode. */
export function hasSocketFileMode(): boolean {
  return process.platform !== 'win32';
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Refuse a socket another user could replace through its directory or any above it, or reach before it is 0600. */
export async function assertSafeSocketDirectory(socketPath: string): Promise<void> {
  const socketDirectory = path.dirname(path.resolve(socketPath));
  for (let directory = socketDirectory; ; directory = path.dirname(directory)) {
    const { mode, uid } = await stat(directory);
    if (uid !== ROOT_UID && uid !== process.getuid?.()) throw new UnsafeSocketDirectoryError(directory, mode, uid);
    if (mode & GROUP_OR_OTHER_WRITE && !(mode & STICKY_BIT)) throw new UnsafeSocketDirectoryError(directory, mode);
    if (path.dirname(directory) === directory) break;
  }
  if (canBindOwnerOnly()) return;
  const { mode } = await stat(socketDirectory);
  if (mode & GROUP_OR_OTHER_ACCESS) {
    throw new SocketPermissionError(
      socketPath,
      `the umask cannot be set here (a worker thread, or a cluster worker whose primary binds the socket), so its ` +
        `directory ${socketDirectory} must be owner-only (0700), not 0${(mode & 0o777).toString(8)}`,
    );
  }
}

/** Whether this thread binds the socket under the umask it sets: a worker thread cannot set it, and a cluster primary binds a worker's socket. */
function canBindOwnerOnly(): boolean {
  if (cluster.isWorker) return false;
  const previousUmask = setUmask(OWNER_ONLY_UMASK);
  if (previousUmask === undefined) return false;
  setUmask(previousUmask);
  return true;
}

function probe(socketPath: string): Promise<'live' | 'stale' | 'gone'> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => {
      socket.destroy();
      resolve('live');
    });
    socket.once('error', (error) => {
      const code = errorCode(error);
      if (code === 'ECONNREFUSED') resolve('stale');
      else if (code === 'ENOENT') resolve('gone');
      else reject(new SocketPathConflictError(socketPath, `connecting to it failed (${code ?? error.message})`));
    });
  });
}

/** Remove a socket a crashed server left behind, and refuse anything else at the path. */
export async function clearStaleSocket(socketPath: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  if (!stats.isSocket()) throw new SocketPathConflictError(socketPath, 'it is not a socket');
  if (stats.uid !== process.getuid?.()) {
    throw new SocketPathConflictError(socketPath, `it belongs to another user (uid ${stats.uid})`);
  }
  const state = await probe(socketPath);
  if (state === 'live') throw new SocketInUseError(socketPath);
  if (state === 'stale') await unlink(socketPath);
}

/** Listen with an owner-only umask, so the socket is never reachable by others, even briefly. */
export function listenOwnerOnly(server: http.Server, socketPath: string, onListening: () => void): void {
  const previousUmask = setUmask(OWNER_ONLY_UMASK);
  try {
    server.listen(socketPath, onListening);
  } finally {
    if (previousUmask !== undefined) setUmask(previousUmask);
  }
}

function setUmask(mask: number): number | undefined {
  try {
    return process.umask(mask);
  } catch {
    return undefined;
  }
}

/** Set the socket to 0600 and check that it took. */
export async function enforceOwnerOnly(socketPath: string): Promise<void> {
  try {
    await chmod(socketPath, OWNER_ONLY_MODE);
  } catch (error) {
    throw new SocketPermissionError(socketPath, `chmod failed (${errorCode(error) ?? String(error)})`);
  }
  const mode = (await lstat(socketPath)).mode & 0o777;
  if (mode !== OWNER_ONLY_MODE) throw new SocketPermissionError(socketPath, `its mode is 0${mode.toString(8)}`);
}
