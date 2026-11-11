import {
  createStorage,
  getEnv,
  getRuntimeContext,
  mkdir,
  realpath,
  sha256Hex,
  stat,
  writeFile,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import { isRedisProvider, redisOptionsSchema, type FrontMcpConfigType } from '../common';
import { findProjectRoot } from '../common/types/options/sqlite/resolve';
import { UnsafeDutyStoreError } from '../errors/duty.errors';
import { isManifestMode } from '../front-mcp/manifest-mode.flag';
import { findReplaceableDirectory } from '../server/security/replaceable-directory';

/** What a lease is for (a duty, a worker, a workflow's schedule): each kind keeps its leases under a prefix of its own. */
export type LeaseKind = 'duty' | 'worker' | 'schedule';

/** Among which processes one holds a lease: those of a machine, of a project root, or of every machine on one Redis. */
export type LeaseScope = 'machine' | 'workspace' | 'cluster';

const OWNER_ONLY_DIRECTORY = 0o700;
const OWNER_ONLY_FILE = 0o600;
const GROUP_OR_OTHER_WRITE = 0o022;

/** Node's `os` and `path`, loaded on first use: leases are Node-only and a browser bundle must not import them. */
function nodeOs(): typeof import('os') {
  return require('os');
}

/** Node's `path`, loaded on first use. */
function nodePath(): typeof import('path') {
  return require('path');
}

/** Duties and workers need a long-lived process: not a serverless function, the edge or a browser. */
export function isLongLivedProcess(): boolean {
  const { runtime, deployment } = getRuntimeContext();
  return deployment !== 'serverless' && runtime !== 'edge' && runtime !== 'browser';
}

/**
 * A server starts its duties and workers, unless a build boots it only to read it; a container starts them only when
 * asked to, which it states in its config.
 */
export function startsBackgroundWork(config: FrontMcpConfigType): boolean {
  return !isManifestMode(config) && (config as { runBackground?: boolean }).runBackground !== false;
}

/**
 * Where the leases live: the server's Redis when it has one, otherwise a SQLite file every process on the machine
 * opens. In Redis a lease is per hostname, except a `'cluster'` one, which every machine shares.
 */
export function leaseStorageConfig(redis: unknown, kind: LeaseKind, scope: LeaseScope): StorageConfig {
  const parsed = redis === undefined ? undefined : redisOptionsSchema.safeParse(redis);
  if (parsed?.success && isRedisProvider(parsed.data)) {
    const { host, port, password, db, tls } = parsed.data;
    return {
      type: 'redis',
      redis: { config: { host, port, password, db, tls } },
      prefix: scope === 'cluster' ? `frontmcp:cluster:${kind}:` : `frontmcp:${kind}:${nodeOs().hostname()}:`,
      fallback: 'error',
    };
  }
  const home = getEnv('FRONTMCP_HOME') || nodePath().join(nodeOs().homedir(), '.frontmcp');
  return {
    type: 'sqlite',
    sqlite: { path: nodePath().join(home, 'duties.sqlite') },
    prefix: `frontmcp:${kind}:`,
    fallback: 'error',
  };
}

/** One lease per server name and duty or worker; a workspace one is also per project root. */
export function leaseKey(name: string, scope: LeaseScope, serverName: string): string {
  const key = [serverName, name].map(encodeURIComponent).join(':');
  if (scope !== 'workspace') return key;
  const cwd = process.cwd();
  return `${key}:${sha256Hex(findProjectRoot(cwd) ?? cwd)}`;
}

/** Open the lease store, creating its SQLite file owner-only first. */
export async function openLeaseStore(config: StorageConfig): Promise<RootStorage> {
  if (config.sqlite) await prepareLeaseFile(config.sqlite.path);
  return createStorage(config);
}

/** Create the lease file and its folder owner-only, and refuse a folder (or one above it) another user can write to. */
async function prepareLeaseFile(file: string): Promise<void> {
  const directory = nodePath().dirname(file);
  await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  if (process.platform !== 'win32') {
    const realDirectory = await realpath(directory);
    const replaceable =
      (await findReplaceableDirectory(directory)) ??
      (realDirectory === directory ? undefined : await findReplaceableDirectory(realDirectory));
    if (replaceable) throw new UnsafeDutyStoreError(replaceable.directory, replaceable.mode, replaceable.ownerUid);
    const { mode } = await stat(realDirectory);
    if (mode & GROUP_OR_OTHER_WRITE) throw new UnsafeDutyStoreError(directory, mode);
  }
  await writeFile(file, '', { mode: OWNER_ONLY_FILE, flag: 'a' });
}

/** The class that holds each lease key in this process, and how many of its instances started. */
export class LeaseClaims {
  private readonly claims = new Map<string, { type: unknown; typeName: string; instances: number }>();

  /**
   * Take `key` for `type`: another class with the same key would never run in this process.
   *
   * @returns The name of the other class that holds `key`, in which case nothing was taken
   */
  claim(key: string, type: { name: string }): string | undefined {
    const claim = this.claims.get(key);
    if (claim && claim.type !== type) return claim.typeName;
    this.claims.set(key, { type, typeName: type.name, instances: (claim?.instances ?? 0) + 1 });
    return undefined;
  }

  /** Drop one started instance's hold on `key`, freeing the key once none is left. */
  release(key: string): void {
    const claim = this.claims.get(key);
    if (!claim) return;
    claim.instances--;
    if (claim.instances === 0) this.claims.delete(key);
  }
}
