import type { Stats } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { getEnv, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from '@frontmcp/utils';

import { InvalidSharedServerOptionsError, UnsafeSharedServerDirectoryError } from '../errors/shared-server.errors';
import { findReplaceableDirectory } from '../server/security/unix-socket-guard';

const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const GROUP_OR_OTHER_ACCESS = 0o077;
// A socket address holds 104 bytes on macOS (108 on Linux), the terminating NUL included.
const MAX_SOCKET_PATH_BYTES = 103;

/** Where a shared server of one key keeps its files, in a folder of its own under `~/.frontmcp/shared`. */
export interface SharedServerFiles {
  directory: string;
  recordFile: string;
  socketPath: string;
  lockFile: string;
}

/** What a shared server writes once it listens: its `info.name`, where it is, and the secret its keys derive from. */
export interface SharedServerRecord {
  name: string;
  transport: 'unix' | 'http';
  port?: number;
  path: string;
  pid: number;
  secret: string;
}

const serverRecordSchema = z
  .object({
    name: z.string(),
    transport: z.enum(['unix', 'http']),
    port: z.number().int().min(1).max(65_535).optional(),
    path: z.string().startsWith('/'),
    pid: z.number().int().positive(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
  .refine(({ transport, port }) => (transport === 'http') === (port !== undefined));

function checksFileModes(): boolean {
  return process.platform !== 'win32';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export function sharedServerFiles(key: string): SharedServerFiles {
  const home = getEnv('FRONTMCP_HOME') || path.join(os.homedir(), '.frontmcp');
  const directory = path.join(path.resolve(home), 'shared', key);
  return {
    directory,
    recordFile: path.join(directory, 'server.json'),
    socketPath: path.join(directory, 'server.sock'),
    lockFile: path.join(directory, 'start-lock.sqlite'),
  };
}

/** Refuse a socket path the platform can't listen on, which would otherwise fail with a bare `EINVAL`. */
export function assertSocketPathFits(files: SharedServerFiles): void {
  if (new TextEncoder().encode(files.socketPath).length <= MAX_SOCKET_PATH_BYTES) return;
  throw new InvalidSharedServerOptionsError(
    `transport: the socket path ${files.socketPath} is longer than ${MAX_SOCKET_PATH_BYTES} bytes; ` +
      "use a shorter key or FRONTMCP_HOME, or transport 'http'",
  );
}

/** Create the key's folder owner-only, and refuse one that another user could replace, or one above it. */
export async function prepareSharedDirectory(files: SharedServerFiles): Promise<void> {
  await mkdir(files.directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  if (!checksFileModes()) return;
  for (const directory of new Set([files.directory, await realpath(files.directory)])) {
    const replaceable = await findReplaceableDirectory(directory);
    if (!replaceable) continue;
    const { ownerUid } = replaceable;
    throw new UnsafeSharedServerDirectoryError(
      replaceable.directory,
      replaceable.mode,
      ownerUid === undefined ? 'the group or others can write to it' : `it belongs to another user (uid ${ownerUid})`,
    );
  }
}

/** Write the record owner-only, then move it into place, so a reader never sees half of one. */
export async function writeServerRecord(files: SharedServerFiles, record: SharedServerRecord): Promise<void> {
  const temporary = `${files.recordFile}.${process.pid}.tmp`;
  await unlink(temporary).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
  await writeFile(temporary, JSON.stringify(record), { mode: OWNER_ONLY_FILE, flag: 'wx' });
  await rename(temporary, files.recordFile);
}

function unsafeFileReason(stats: Stats): string | undefined {
  if (!stats.isFile()) return 'it is not a regular file';
  if (stats.uid !== process.getuid?.()) return `it belongs to another user (uid ${stats.uid})`;
  if (stats.mode & GROUP_OR_OTHER_ACCESS) return 'the group or others can read it';
  return undefined;
}

/** The running server's record, or `undefined` when there is none or it can't be read as one. */
export async function readServerRecord(files: SharedServerFiles): Promise<SharedServerRecord | undefined> {
  let stats: Stats;
  try {
    stats = await lstat(files.recordFile);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const unsafe = checksFileModes() ? unsafeFileReason(stats) : undefined;
  if (unsafe) throw new UnsafeSharedServerDirectoryError(files.recordFile, stats.mode, unsafe);
  let content: unknown;
  try {
    content = JSON.parse(await readFile(files.recordFile));
  } catch {
    return undefined;
  }
  const parsed = serverRecordSchema.safeParse(content);
  return parsed.success ? parsed.data : undefined;
}

/** Remove the record when the server `pid` wrote it, leaving one a newer server wrote in place. */
export async function removeServerRecord(files: SharedServerFiles, pid: number): Promise<void> {
  const record = await readServerRecord(files).catch(() => undefined);
  if (record?.pid !== pid) return;
  await unlink(files.recordFile).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
}
