import type { Readable, Writable } from 'node:stream';

import {
  createBridgeStateMachine,
  createHttpUpstream,
  createStdioFramer,
  listChangedNotifications,
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
import type { EmbeddedSharedServer } from './shared-embedded';
import { SHARED_EXITING, SHARED_STATE_HEADER } from './shared-endpoint';
import { assertSocketPathFits, prepareSharedDirectory, sharedServerFiles } from './shared-files';
import type { ResolvedSharedServerOptions } from './shared-server.options';
import { openStartLockStorage, SharedStartLock } from './start-lock';

const BUFFER_SIZE = 16;
/** How long past its attach budget a session waits for a server, its own included, before it gives up. */
const RELOAD_MARGIN_MS = 30_000;
/** How many times a request no server took, or a replayed `initialize` a server dropped, is sent to the next server. */
const MAX_RESENDS = 3;
/** Errors of a request that never reached a server: nothing listened where it was sent. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOENT']);

export interface AttachSharedSessionOptions extends ResolvedSharedServerOptions {
  input: Readable;
  output: Writable;
  /** The session's own `info.name`: it attaches only to a server of that name. */
  name: string;
  /** The session's own version, `info.version`: it never attaches to an older server. */
  version: string;
  /** Run the server in this process, when the session can't, or may not, attach to the key's server. */
  embed(): Promise<EmbeddedSharedServer>;
  spawnServer?: (startLockHolder: string) => SpawnedServer;
}

export interface SharedSession {
  /** Resolves once the session reaches a server; rejects, after answering the requests it held, when it can't. */
  readonly attached: Promise<void>;
  stop(): Promise<void>;
}

/** Where a session sends its requests: the key's server, or the one it runs itself. */
type ServerToReach = Pick<EmbeddedSharedServer, 'url' | 'headers' | 'fetch'>;

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

async function connect(options: AttachSharedSessionOptions, logger: BridgeLogger): Promise<SharedServerAttachment> {
  const files = sharedServerFiles(options.key);
  if (options.transport === 'unix') assertSocketPathFits(files);
  await prepareSharedDirectory(files);
  try {
    return await ensureSharedServer({
      key: options.key,
      transport: options.transport,
      files,
      logger,
      name: options.name,
      version: options.version,
      replaceOlder: options.replaceOlder,
      budgetMs: options.attachBudgetMs,
      spawnServer: options.spawnServer ?? ((startLockHolder) => spawnSharedServer(options.key, startLockHolder)),
      openLock: async () => {
        const storage = await openStartLockStorage(files);
        return { lock: new SharedStartLock(storage, options.key), close: () => storage.disconnect() };
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
 * when it can't attach to one, it runs the server in its own process.
 */
export function attachSharedSession(options: AttachSharedSessionOptions): SharedSession {
  const log = stderrLogger();
  let upstream: HttpUpstreamClient | undefined;
  let embedded: EmbeddedSharedServer | undefined;
  let stopping: Promise<void> | undefined;
  let clientInitialize: JsonRpcFrame | undefined;
  let clientInitialized = false;
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
      await current.send(frame);
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

  /** Stop sending to a server that went away, and reach the next one; what it still answers is still relayed. */
  function lose(lost: HttpUpstreamClient, error: SharedServerLostError): void {
    if (upstream !== lost || stopping) return;
    upstream = undefined;
    log.warn('reaching the next shared server', { reason: error.message });
    fsm.onUpstreamLost(error.message);
    reach().catch(fail);
  }

  function fail(error: unknown): void {
    const message = messageOf(error);
    log.error('attach-failed', { error: message });
    fsm.onReloadDeadline({ error: message });
  }

  async function serverToReach(): Promise<ServerToReach> {
    if (embedded) return embedded;
    const attachment = await connect(options, log);
    if ('server' in attachment) {
      const { url, token, fetch: send } = attachment.server;
      return { url, headers: { authorization: `Bearer ${token}` }, fetch: send };
    }
    log.warn(`running the shared server "${options.key}" in this process: ${attachment.embedded}`);
    embedded = await options.embed();
    return embedded;
  }

  /** Reach a server and replay the client's `initialize` on it; one that goes away during the replay is replaced. */
  async function reach(): Promise<void> {
    for (let replays = 0; ; replays++) {
      const server = await serverToReach();
      if (stopping) {
        await embedded?.close();
        return;
      }
      const next = createHttpUpstream({
        url: server.url,
        headers: server.headers,
        fetch: towardsServer(server.fetch),
        log,
        onFrame: (frame) => fsm.relayUpstream(frame),
      });
      try {
        if (clientInitialize) {
          const result = await next.reinitialize(clientInitialize, clientInitialized);
          for (const notification of listChangedNotifications(result)) await framer.write(notification);
        }
      } catch (error) {
        await next.close();
        if (error instanceof SharedServerLostError && replays < MAX_RESENDS) continue;
        throw error;
      }
      upstream = next;
      fsm.onChildReady();
      return;
    }
  }

  framer.start();
  fsm.onBootStart();
  const attached = reach().catch((error: unknown) => {
    fail(error);
    throw error;
  });
  attached.catch(() => undefined);

  async function shutdown(): Promise<void> {
    await fsm.stop();
    await upstream?.endSession();
    await upstream?.close();
    await embedded?.close();
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
