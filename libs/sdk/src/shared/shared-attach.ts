import type { Readable, Writable } from 'node:stream';

import {
  createBridgeStateMachine,
  createHttpUpstream,
  createStdioFramer,
  listChangedNotifications,
  stat,
  type BridgeLogger,
  type HttpUpstreamClient,
  type JsonRpcFrame,
} from '@frontmcp/utils';

import { InternalMcpError } from '../errors/mcp.error';
import { SharedServerIdentityError, SharedServerStartError } from '../errors/shared-server.errors';
import {
  ensureSharedServer,
  spawnSharedServer,
  type SharedServerAttachment,
  type SpawnedServer,
} from './ensure-shared-server';
import type { BootedEmbeddedServer, EmbeddedSharedServer } from './shared-embedded';
import { SHARED_EXITING, SHARED_STATE_HEADER } from './shared-endpoint';
import {
  assertSocketPathFits,
  prepareSharedDirectory,
  readServerRecord,
  sharedServerFiles,
  type SharedServerRecord,
} from './shared-files';
import { readSharedServerKey, type ResolvedSharedServerOptions } from './shared-server.options';
import { openStartLockStorage, SharedStartLock } from './start-lock';

const BUFFER_SIZE = 16;
/** How long past its attach budget a session waits for a server, its own included, before it gives up. */
const RELOAD_MARGIN_MS = 30_000;
/** How many times a request no server took, or a replayed `initialize` a server dropped, is sent to the next server. */
const MAX_RESENDS = 3;
/** Errors of a request that never reached a server: nothing listened where it was sent. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOENT']);
/** How often a session that lost its notification stream reads the key's record for a server that took it over. */
const SUCCESSOR_WATCH_MS = 1_000;

export interface AttachSharedSessionOptions extends ResolvedSharedServerOptions {
  input: Readable;
  output: Writable;
  /** The session's own `info.name`: it attaches only to a server of that name. */
  name: string;
  /** The session's own version, `info.version`: it never attaches to an older server. */
  version: string;
  /** Boot the server of `key` in this process, serving nothing until started; with `spare`, while attaching. */
  bootEmbedded(key: string): Promise<BootedEmbeddedServer>;
  /** Start the server of `key`: one the session's own config names (see {@link mayStartServerOf}). */
  spawnServer?: (startLockHolder: string, key: string) => SpawnedServer;
  /** What `keyFileSignature()` said of `rereadKey.file` before the first key read: a change since moves the session. */
  keySignature?: string;
}

/** What tells a change of the key file: its size and time, or that it is missing. */
export async function keyFileSignature(file: string): Promise<string> {
  try {
    const { size, mtimeMs } = await stat(file);
    return `${size}:${mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/** Whether a session may start the server of `key`: its first key's, with its own entry, or one its `entries` name. */
export function mayStartServerOf(options: Pick<AttachSharedSessionOptions, 'key' | 'entries'>, key: string): boolean {
  return key === options.key || Object.hasOwn(options.entries, key);
}

export interface SharedSession {
  /** Resolves once the session reaches a server; rejects, after answering the requests it held, when it can't. */
  readonly attached: Promise<void>;
  stop(): Promise<void>;
}

/** Where a session sends its requests: the key's server, with its `pid`, or the one it runs itself, which has none. */
type ServerToReach = Pick<EmbeddedSharedServer, 'url' | 'headers' | 'fetch'> & { pid?: number };

/** The server a session sent a request to went away; `reached` when the request may have reached it first. */
export class SharedServerLostError extends InternalMcpError {
  constructor(
    readonly reached: boolean,
    reason: string,
  ) {
    super(`the shared server went away: ${reason}`, 'SHARED_SERVER_LOST');
  }
}

/** Warnings and errors go to stderr: stdout carries the session's frames. */
function stderrLogger(): BridgeLogger {
  const ignore = (): void => undefined;
  const write =
    (level: string) =>
    (message: string, data?: Record<string, unknown>): void => {
      process.stderr.write(`[frontmcp shared] ${level} ${message}${data ? ` ${JSON.stringify(data)}` : ''}\n`);
    };
  return {
    path: undefined,
    debug: ignore,
    info: ignore,
    reloadEvent: ignore,
    warn: write('warn'),
    error: write('error'),
    close: async () => undefined,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): unknown {
  const code = (error as { code?: unknown } | undefined)?.code;
  return code ?? (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
}

/** Report a server that went away, and whether the request could have reached it, instead of a bare network error. */
export function towardsServer(send: typeof fetch): typeof fetch {
  return async (input, init) => {
    let response: Response;
    try {
      response = await send(input, init);
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const neverSent = error instanceof SharedServerIdentityError || NOT_SENT_CODES.has(String(codeOf(error)));
      throw new SharedServerLostError(!neverSent, messageOf(error));
    }
    const exiting = response.status === 503 && response.headers.get(SHARED_STATE_HEADER) === SHARED_EXITING;
    if (response.status !== 401 && !exiting) return response;
    await response.body?.cancel();
    throw new SharedServerLostError(false, exiting ? 'it is exiting' : 'it no longer knows the token');
  };
}

/** Start the server of `key` with the entry the session's config names for it: its own for its first key. */
function spawnerOf(options: AttachSharedSessionOptions, key: string): (startLockHolder: string) => SpawnedServer {
  if (options.spawnServer) return (startLockHolder) => options.spawnServer?.(startLockHolder, key) as SpawnedServer;
  const entry = key === options.key ? undefined : options.entries[key];
  return (startLockHolder) => spawnSharedServer(key, startLockHolder, entry);
}

/** Reach the server of `key`, starting or replacing it only when the session's config lets it start that key's. */
async function connect(
  options: AttachSharedSessionOptions,
  key: string,
  logger: BridgeLogger,
): Promise<SharedServerAttachment> {
  const files = sharedServerFiles(key);
  if (options.transport === 'unix') assertSocketPathFits(files);
  await prepareSharedDirectory(files);
  try {
    return await ensureSharedServer({
      key,
      transport: options.transport,
      files,
      logger,
      name: options.name,
      version: options.version,
      replaceOlder: options.replaceOlder,
      budgetMs: options.attachBudgetMs,
      mayStart: mayStartServerOf(options, key),
      spawnServer: spawnerOf(options, key),
      openLock: async () => {
        const storage = await openStartLockStorage(files);
        return { lock: new SharedStartLock(storage, key), close: () => storage.disconnect() };
      },
    });
  } catch (error) {
    if (error instanceof SharedServerStartError) return { embedded: error.message };
    throw error;
  }
}

/**
 * Bridge a stdio session to the key's server; frames sent before it reached one wait in the buffer. When that server
 * goes away, the session reaches the next one, replays the client's `initialize` and tells it the lists changed;
 * when it can't attach to one, it runs the server in its own process. What the server sends on its own reaches the
 * client over the session's notification stream, a Claude Code channel event included. A session that lost that
 * stream follows a server that took its key over, without waiting for a request of its client.
 */
export function attachSharedSession(options: AttachSharedSessionOptions): SharedSession {
  const log = stderrLogger();
  /** The key whose server the session reaches: its first, until a function `key` answers another. */
  let currentKey = options.key;
  /** The requests each server has in flight, which a server the session moves from finishes. */
  const sending = new Map<HttpUpstreamClient, Set<Promise<void>>>();
  let reaching: Promise<void> | undefined;
  let keyWatch: NodeJS.Timeout | undefined;
  let upstream: HttpUpstreamClient | undefined;
  let embedded: EmbeddedSharedServer | undefined;
  /** The server booting in this process while the session first attaches, with `spare`. */
  let spare: Promise<BootedEmbeddedServer> | undefined;
  /** The dropped spare's shutdown, which the session's stop waits for. */
  let spareClosed: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let clientInitialize: JsonRpcFrame | undefined;
  let clientInitialized = false;
  let successorWatch: NodeJS.Timeout | undefined;
  const resends = new WeakMap<JsonRpcFrame, number>();
  const framer = createStdioFramer({
    input: options.input,
    output: options.output,
    log,
    onFrame: (frame) => fsm.enqueue(frame),
  });
  const fsm = createBridgeStateMachine({
    log,
    bufferSize: BUFFER_SIZE,
    reloadDeadlineMs: options.attachBudgetMs + RELOAD_MARGIN_MS,
    respond: (frame) => framer.write(frame),
    forward,
  });

  async function forward(frame: JsonRpcFrame): Promise<void> {
    if (frame.method === 'initialize' && frame.id !== undefined && frame.id !== null) {
      clientInitialize = frame;
      clientInitialized = false;
    } else if (frame.method === 'notifications/initialized') {
      clientInitialized = true;
    }
    const current = upstream;
    if (!current) throw new Error('the session has not reached its shared server');
    try {
      await sendTracked(current, frame);
    } catch (error) {
      if (!(error instanceof SharedServerLostError)) throw error;
      lose(current, error);
      if (frame === clientInitialize) clientInitialize = undefined;
      const resent = resends.get(frame) ?? 0;
      if (error.reached || resent >= MAX_RESENDS) throw error;
      resends.set(frame, resent + 1);
      await fsm.requeue(frame);
    }
  }

  /** Send `frame` to `server`, counted among its requests in flight until it is answered. */
  async function sendTracked(server: HttpUpstreamClient, frame: JsonRpcFrame): Promise<void> {
    const sent = server.send(frame);
    let inFlight = sending.get(server);
    if (!inFlight) sending.set(server, (inFlight = new Set()));
    inFlight.add(sent);
    try {
      await sent;
    } finally {
      inFlight.delete(sent);
    }
  }

  /** Leave a server that went away, and reach the next one; its answers to the requests in flight are still relayed. */
  function lose(lost: HttpUpstreamClient, error: SharedServerLostError): void {
    if (upstream !== lost || stopping) return;
    upstream = undefined;
    endSuccessorWatch();
    lost.leaveSession();
    log.warn('reaching the next shared server', { reason: error.message });
    fsm.onUpstreamLost(error.message);
    reaching = reach().catch(fail);
  }

  /** Watch `rereadKey.file`: each change (it appears, goes, or its size or time changes) reads the key again. */
  async function watchKey(): Promise<void> {
    const { rereadKey, keySource } = options;
    if (!rereadKey || !keySource) return;
    // Without the signature from before the first read, one read now catches a change made since
    let last = options.keySignature ?? (await keyFileSignature(rereadKey.file));
    let checking = false;
    let again = false;
    const check = async (): Promise<void> => {
      if (checking) {
        again = true;
        return;
      }
      checking = true;
      try {
        do {
          again = false;
          await checkKey().catch((error: unknown) =>
            log.warn('the key was not read again', { error: messageOf(error) }),
          );
        } while (again && !stopping);
      } finally {
        checking = false;
      }
    };
    keyWatch = setInterval(async () => {
      if (stopping) return;
      const now = await keyFileSignature(rereadKey.file);
      if (now === last) return;
      last = now;
      await check();
    }, rereadKey.intervalMs);
    keyWatch.unref();
    if (options.keySignature === undefined) await check();
  }

  /** Read the key again; a new one moves the session, and one that can't be read keeps the current key. */
  async function checkKey(): Promise<void> {
    if (!options.keySource) return;
    const read = await readSharedServerKey(options.keySource);
    if ('error' in read) {
      log.warn(`keeping the shared server key "${currentKey}": ${read.error}`);
      return;
    }
    if (read.key !== currentKey) await moveTo(read.key);
  }

  /** Move to the server of `key`, attaching as at the start; the old one finishes its requests, else stay. */
  async function moveTo(key: string): Promise<void> {
    await attached.catch(() => undefined);
    await reaching;
    const from = upstream;
    if (stopping || !from) return;
    const stay = (reason: string) => log.warn(`staying on the shared server "${currentKey}": ${reason}`);
    let attachment: SharedServerAttachment;
    try {
      attachment = await connect(options, key, log);
    } catch (error) {
      stay(`the server of key "${key}" can't be reached (${messageOf(error)})`);
      return;
    }
    if ('embedded' in attachment) {
      stay(`the server of key "${key}" can't be reached (${attachment.embedded})`);
      return;
    }
    const { url, token, fetch: send, pid } = attachment.server;
    const server: ServerToReach = { url, headers: { authorization: `Bearer ${token}` }, fetch: send, pid };
    const left = embedded;
    let moved = false;
    // The new server is taken only while the session is still on the server it moves from
    const adopt = (next: HttpUpstreamClient): boolean => {
      if (upstream !== from || stopping) return false;
      moved = true;
      upstream = next;
      embedded = undefined;
      currentKey = key;
      endSuccessorWatch();
      log.warn(`moved to the shared server "${key}"`);
      return true;
    };
    try {
      await reach(async () => server, adopt);
    } catch (error) {
      stay(`the server of key "${key}" did not take the session (${messageOf(error)})`);
      return;
    }
    if (moved) void leave(from, left);
  }

  /** Let a server the session moved from finish its requests in flight, then end the session there. */
  async function leave(server: HttpUpstreamClient, ownServer: EmbeddedSharedServer | undefined): Promise<void> {
    await Promise.allSettled([...(sending.get(server) ?? [])]);
    sending.delete(server);
    await server.endSession();
    await server.close();
    await ownServer?.close();
  }

  /** Stop reading the key's record for a server that took the key over. */
  function endSuccessorWatch(): void {
    clearInterval(successorWatch);
    successorWatch = undefined;
  }

  /** Watch the key's record once the attached server's stream is lost, to follow a server that took the key over. */
  function watchForSuccessor(lost: HttpUpstreamClient, lostPid: number | undefined): void {
    if (lostPid === undefined || upstream !== lost || successorWatch || stopping) return;
    successorWatch = setInterval(() => void moveToSuccessor(lost, lostPid), SUCCESSOR_WATCH_MS);
    successorWatch.unref();
    void moveToSuccessor(lost, lostPid);
  }

  /** Whether the record names a server to move to: another process, of the session's transport and `info.name`. */
  function isSuccessor(record: SharedServerRecord | undefined, lostPid: number): boolean {
    if (!record || record.pid === lostPid) return false;
    return record.transport === options.transport && record.name === options.name;
  }

  /** Move to the server the key's record names now, when one took the key over; start none, and embed none. */
  async function moveToSuccessor(lost: HttpUpstreamClient, lostPid: number): Promise<void> {
    let record: SharedServerRecord | undefined;
    try {
      record = await readServerRecord(sharedServerFiles(currentKey));
    } catch (error) {
      if (upstream !== lost || stopping) return;
      endSuccessorWatch();
      log.warn('no longer watching for the next shared server', { reason: messageOf(error) });
      return;
    }
    if (!isSuccessor(record, lostPid)) return;
    lose(lost, new SharedServerLostError(false, 'another server took its key over'));
  }

  function fail(error: unknown): void {
    const message = messageOf(error);
    log.error('attach-failed', { error: message });
    fsm.onReloadDeadline({ error: message });
  }

  /** The server to send the requests to; none once the session stops. */
  async function serverToReach(): Promise<ServerToReach | undefined> {
    if (embedded) return embedded;
    let attachment: SharedServerAttachment;
    try {
      attachment = await connect(options, currentKey, log);
    } catch (error) {
      dropSpare();
      throw error;
    }
    if (stopping) {
      dropSpare();
      return undefined;
    }
    if ('server' in attachment) {
      dropSpare();
      const { url, token, fetch: send, pid } = attachment.server;
      return { url, headers: { authorization: `Bearer ${token}` }, fetch: send, pid };
    }
    log.warn(`running the shared server "${currentKey}" in this process: ${attachment.embedded}`);
    // Kept as the spare until it booted, so a stop meanwhile shuts it down instead of starting it
    spare ??= options.bootEmbedded(currentKey);
    const booted = await spare;
    if (stopping) return undefined;
    spare = undefined;
    embedded = await booted.start();
    return embedded;
  }

  /** Shut the spare down: the session reached the key's server, or stops. A spare that failed to boot is let go. */
  function dropSpare(): void {
    const booting = spare;
    if (!booting) return;
    spare = undefined;
    spareClosed = booting.then(
      (booted) =>
        booted
          .close()
          .catch((error: unknown) => log.warn('the spare server did not shut down', { error: messageOf(error) })),
      () => undefined,
    );
  }

  /** Take `next` as the server to send the requests to. */
  function useUpstream(next: HttpUpstreamClient): boolean {
    upstream = next;
    return true;
  }

  /** Reach a server and replay the client's `initialize` on it; one that goes away during the replay is replaced. */
  async function reach(
    serverOf: () => Promise<ServerToReach | undefined> = serverToReach,
    adopt: (next: HttpUpstreamClient) => boolean = useUpstream,
  ): Promise<void> {
    for (let replays = 0; ; replays++) {
      const server = await serverOf();
      if (!server || stopping) {
        await embedded?.close();
        return;
      }
      const next: HttpUpstreamClient = createHttpUpstream({
        url: server.url,
        headers: server.headers,
        fetch: towardsServer(server.fetch),
        log,
        onFrame: (frame) => fsm.relayUpstream(frame),
        claudeCodeChannels: true,
        onNotificationStreamLost: () => watchForSuccessor(next, server.pid),
      });
      let result: Record<string, unknown> | undefined;
      try {
        if (clientInitialize) result = await next.reinitialize(clientInitialize, clientInitialized);
      } catch (error) {
        await next.close();
        if (error instanceof SharedServerLostError && replays < MAX_RESENDS) continue;
        throw error;
      }
      if (!adopt(next)) {
        await next.close();
        return;
      }
      if (clientInitialize) {
        for (const notification of listChangedNotifications(result)) await framer.write(notification);
      }
      fsm.onChildReady();
      return;
    }
  }

  framer.start();
  fsm.onBootStart();
  if (options.spare) {
    // Booted while the session first attaches; a boot that fails is told when the session falls back to it
    spare = options.bootEmbedded(currentKey);
    spare.catch(() => undefined);
  }
  const attached = reach().catch((error: unknown) => {
    fail(error);
    throw error;
  });
  attached.catch(() => undefined);
  void watchKey();

  async function shutdown(): Promise<void> {
    clearInterval(keyWatch);
    endSuccessorWatch();
    dropSpare();
    await fsm.stop();
    await upstream?.endSession();
    await upstream?.close();
    await embedded?.close();
    await spareClosed;
    framer.stop();
  }

  return {
    attached,
    stop: async () => {
      stopping ??= shutdown();
      await stopping;
    },
  };
}
