import { deriveSharedServerKeys } from '@frontmcp/auth';
import { getSpawnFn, type BridgeLogger } from '@frontmcp/utils';

import { SharedServerStartError } from '../errors/shared-server.errors';
import {
  fetchAfterIdentity,
  httpEndpoint,
  identifySharedServer,
  requestSharedServerDrain,
  unixEndpoint,
  type SharedEndpoint,
} from './shared-endpoint';
import { readServerRecord, type SharedServerFiles, type SharedServerRecord } from './shared-files';
import type { SharedServerTransport } from './shared-server.options';
import { compareSharedVersions } from './shared-version';
import type { SharedStartLock } from './start-lock';

/** Set on the process a session starts: the key that process serves instead of attaching to it. */
export const SHARED_SERVE_ENV = 'FRONTMCP_SHARED_SERVE';
/** Set beside it: the holder of the start lock the session took, which the server keeps until its record is written. */
export const SHARED_START_LOCK_ENV = 'FRONTMCP_SHARED_START_LOCK';

const POLL_MS = 100;

/** A server process a session started; `exitReason` is set once it can no longer come up. */
export interface SpawnedServer {
  readonly exitReason: string | undefined;
}

export interface AttachedSharedServer {
  url: string;
  token: string;
  pid: number;
  /** The version the server proved it runs. */
  version: string;
  endpoint: SharedEndpoint;
  /** Sends the session's requests; over loopback HTTP, each only once the endpoint proved its identity again. */
  fetch: typeof fetch;
}

/** The session attached to the key's server, or it runs the server itself, for the reason given. */
export type SharedServerAttachment = { server: AttachedSharedServer } | { embedded: string };

export interface StartLockHandle {
  lock: SharedStartLock;
  close(): Promise<void>;
}

export interface EnsureSharedServerOptions {
  key: string;
  transport: SharedServerTransport;
  files: SharedServerFiles;
  /** The session's own version: it never attaches to an older server. */
  version: string;
  /** Whether it drains an older server and starts its own, instead of running the server itself. */
  replaceOlder: boolean;
  /** How long it may take, including starting or replacing a server. */
  budgetMs: number;
  openLock(): Promise<StartLockHandle>;
  spawnServer(startLockHolder: string): SpawnedServer;
  pollMs?: number;
  logger: Pick<BridgeLogger, 'warn'>;
}

/** A server that proved its identity, with the keys of its record. */
interface FoundServer {
  server: AttachedSharedServer;
  proofKey: Uint8Array;
}

function endpointOf(files: SharedServerFiles, record: SharedServerRecord): SharedEndpoint | undefined {
  if (record.transport === 'unix') return unixEndpoint(files.socketPath);
  return record.port === undefined ? undefined : httpEndpoint(record.port);
}

/** The recorded server once it proved its identity; a process that can't is logged once and sent nothing more. */
async function findRunning(
  options: EnsureSharedServerOptions,
  refused: Set<string>,
  timeoutMs: number,
): Promise<FoundServer | undefined> {
  const record = await readServerRecord(options.files);
  if (!record || record.transport !== options.transport) return undefined;
  const endpoint = endpointOf(options.files, record);
  if (!endpoint) return undefined;
  const { proofKey, token } = deriveSharedServerKeys(record.secret);
  const identified = await identifySharedServer(endpoint, proofKey, timeoutMs);
  if (identified.outcome === 'verified') {
    const send = record.transport === 'http' ? fetchAfterIdentity(endpoint, proofKey) : endpoint.fetch;
    const url = `${endpoint.baseUrl}${record.path}`;
    return { proofKey, server: { url, token, pid: record.pid, version: identified.version, endpoint, fetch: send } };
  }
  if (identified.outcome === 'refused' && !refused.has(endpoint.id)) {
    refused.add(endpoint.id);
    options.logger.warn(
      `the process at ${endpoint.id} did not prove it is the shared server "${options.key}"; it was not sent the token`,
    );
  }
  return undefined;
}

/** Whether the session attaches to `found`, replaces it, or runs the server itself, and why. */
function skewOf(found: FoundServer, options: EnsureSharedServerOptions): { embedded: string } | 'attach' | 'replace' {
  const { version } = found.server;
  const order = compareSharedVersions(version, options.version);
  if (order === undefined) {
    return {
      embedded: `the shared server runs version ${version}, which can't be ordered against this session's ${options.version}`,
    };
  }
  if (order >= 0) return 'attach';
  if (options.replaceOlder) return 'replace';
  return {
    embedded: `the shared server runs version ${version}, older than this session's ${options.version}, and replaceOlder is off`,
  };
}

/**
 * Attach to the key's server once it proves its identity and a version no older than the session's. If none does,
 * the start lock's holder starts one; an older one it first asks to drain, and waits for it to go.
 */
export async function ensureSharedServer(options: EnsureSharedServerOptions): Promise<SharedServerAttachment> {
  const { key, budgetMs, pollMs = POLL_MS } = options;
  const deadline = Date.now() + budgetMs;
  const remaining = (): number => Math.max(deadline - Date.now(), 1);
  const refused = new Set<string>();
  let handle: StartLockHandle | undefined;
  let holding = false;
  let spawned: SpawnedServer | undefined;
  let draining: FoundServer | undefined;
  try {
    for (;;) {
      const found = await findRunning(options, refused, remaining());
      const skew = found && skewOf(found, options);
      if (found && skew === 'attach') return { server: found.server };
      if (typeof skew === 'object') return skew;
      handle ??= await options.openLock();
      holding = holding ? await handle.lock.renew() : await handle.lock.acquire();
      if (holding && found) {
        if (draining?.server.endpoint.id !== found.server.endpoint.id) {
          if (await requestSharedServerDrain(found.server, options.version)) draining = found;
        }
      } else if (holding && !(draining && (await stillServes(draining, remaining())))) {
        spawned ??= options.spawnServer(handle.lock.holder);
      }
      if (spawned?.exitReason) {
        if (holding) throw new SharedServerStartError(key, spawned.exitReason);
        spawned = undefined;
      }
      if (Date.now() >= deadline) {
        throw new SharedServerStartError(key, `no server proved its identity within ${budgetMs} ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining())));
    }
  } finally {
    if (holding) await handle?.lock.release().catch(() => undefined);
    await handle?.close();
  }
}

/** Whether a server that agreed to drain still holds its endpoint, which the next server may need. */
async function stillServes(drained: FoundServer, timeoutMs: number): Promise<boolean> {
  const { outcome } = await identifySharedServer(drained.server.endpoint, drained.proofKey, timeoutMs);
  return outcome === 'verified' || outcome === 'exiting';
}

/** Run this process's entry again, detached, as the key's server: it outlives the session that started it. */
export function spawnSharedServer(key: string, startLockHolder: string): SpawnedServer {
  const spawned: { exitReason: string | undefined } = { exitReason: undefined };
  const child = getSpawnFn()(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, [SHARED_SERVE_ENV]: key, [SHARED_START_LOCK_ENV]: startLockHolder },
  });
  child.once('error', (error) => {
    spawned.exitReason = `it could not be started (${error.message})`;
  });
  child.once('exit', (code, signal) => {
    spawned.exitReason ??= `it exited with ${signal ?? `code ${code}`}`;
  });
  child.unref();
  return spawned;
}
