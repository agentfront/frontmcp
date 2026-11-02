import { deriveSharedServerKeys } from '@frontmcp/auth';
import { getSpawnFn, type BridgeLogger } from '@frontmcp/utils';

import { SharedServerStartError } from '../errors/shared-server.errors';
import {
  fetchAfterIdentity,
  httpEndpoint,
  identifySharedServer,
  unixEndpoint,
  type SharedEndpoint,
} from './shared-endpoint';
import { readServerRecord, type SharedServerFiles, type SharedServerRecord } from './shared-files';
import type { SharedServerTransport } from './shared-server.options';
import type { SharedStartLock } from './start-lock';

/** Set on the process a session starts: the key that process serves instead of attaching to it. */
export const SHARED_SERVE_ENV = 'FRONTMCP_SHARED_SERVE';
/** Set beside it: the holder of the start lock the session took, which the server keeps until its record is written. */
export const SHARED_START_LOCK_ENV = 'FRONTMCP_SHARED_START_LOCK';

const START_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

/** A server process a session started; `exitReason` is set once it can no longer come up. */
export interface SpawnedServer {
  readonly exitReason: string | undefined;
}

export interface AttachedSharedServer {
  url: string;
  token: string;
  pid: number;
  endpoint: SharedEndpoint;
  /** Sends the session's requests; over loopback HTTP, each only once the endpoint proved its identity again. */
  fetch: typeof fetch;
}

export interface StartLockHandle {
  lock: SharedStartLock;
  close(): Promise<void>;
}

export interface EnsureSharedServerOptions {
  key: string;
  transport: SharedServerTransport;
  files: SharedServerFiles;
  openLock(): Promise<StartLockHandle>;
  spawnServer(startLockHolder: string): SpawnedServer;
  startTimeoutMs?: number;
  pollMs?: number;
  logger: Pick<BridgeLogger, 'warn'>;
}

function endpointOf(files: SharedServerFiles, record: SharedServerRecord): SharedEndpoint | undefined {
  if (record.transport === 'unix') return unixEndpoint(files.socketPath);
  return record.port === undefined ? undefined : httpEndpoint(record.port);
}

/** The recorded server once it proved its identity; a process that can't is logged once and sent nothing more. */
async function attachToRunning(
  options: EnsureSharedServerOptions,
  refused: Set<string>,
): Promise<AttachedSharedServer | undefined> {
  const record = await readServerRecord(options.files);
  if (!record || record.transport !== options.transport) return undefined;
  const endpoint = endpointOf(options.files, record);
  if (!endpoint) return undefined;
  const { proofKey, token } = deriveSharedServerKeys(record.secret);
  const outcome = await identifySharedServer(endpoint, proofKey);
  if (outcome === 'verified') {
    const send = record.transport === 'http' ? fetchAfterIdentity(endpoint, proofKey) : endpoint.fetch;
    return { url: `${endpoint.baseUrl}${record.path}`, token, pid: record.pid, endpoint, fetch: send };
  }
  if (outcome === 'refused' && !refused.has(endpoint.id)) {
    refused.add(endpoint.id);
    options.logger.warn(
      `the process at ${endpoint.id} did not prove it is the shared server "${options.key}"; it was not sent the token`,
    );
  }
  return undefined;
}

/** Attach to the key's server once it proves its identity; if none does, the start lock's holder starts one. */
export async function ensureSharedServer(options: EnsureSharedServerOptions): Promise<AttachedSharedServer> {
  const { key, startTimeoutMs = START_TIMEOUT_MS, pollMs = POLL_MS } = options;
  const deadline = Date.now() + startTimeoutMs;
  const refused = new Set<string>();
  let handle: StartLockHandle | undefined;
  let holding = false;
  let spawned: SpawnedServer | undefined;
  try {
    for (;;) {
      const attached = await attachToRunning(options, refused);
      if (attached) return attached;
      handle ??= await options.openLock();
      holding = holding ? await handle.lock.renew() : await handle.lock.acquire();
      if (holding) spawned ??= options.spawnServer(handle.lock.holder);
      if (spawned?.exitReason) {
        if (holding) throw new SharedServerStartError(key, spawned.exitReason);
        spawned = undefined;
      }
      if (Date.now() >= deadline) {
        throw new SharedServerStartError(key, `no server proved its identity within ${startTimeoutMs} ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    if (holding) await handle?.lock.release().catch(() => undefined);
    await handle?.close();
  }
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
