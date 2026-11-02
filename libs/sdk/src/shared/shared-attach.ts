import type { Readable, Writable } from 'node:stream';

import {
  createBridgeStateMachine,
  createHttpUpstream,
  createStdioFramer,
  type BridgeLogger,
  type HttpUpstreamClient,
} from '@frontmcp/utils';

import {
  ensureSharedServer,
  spawnSharedServer,
  type AttachedSharedServer,
  type SpawnedServer,
} from './ensure-shared-server';
import { prepareSharedDirectory, sharedServerFiles } from './shared-files';
import type { ResolvedSharedServerOptions } from './shared-server.options';
import { openStartLockStorage, SharedStartLock } from './start-lock';

const BUFFER_SIZE = 16;
const RELOAD_DEADLINE_MS = 30_000;

export interface AttachSharedSessionOptions extends ResolvedSharedServerOptions {
  input: Readable;
  output: Writable;
  spawnServer?: () => SpawnedServer;
}

export interface SharedSession {
  /** Resolves once the session reaches its server; rejects, after answering the requests it held, when it can't. */
  readonly attached: Promise<void>;
  stop(): Promise<void>;
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

async function connect(options: AttachSharedSessionOptions, logger: BridgeLogger): Promise<AttachedSharedServer> {
  const files = sharedServerFiles(options.key);
  await prepareSharedDirectory(files);
  return ensureSharedServer({
    key: options.key,
    transport: options.transport,
    files,
    logger,
    spawnServer: options.spawnServer ?? (() => spawnSharedServer(options.key)),
    openLock: async () => {
      const storage = await openStartLockStorage(files);
      return { lock: new SharedStartLock(storage, options.key), close: () => storage.disconnect() };
    },
  });
}

/** Bridge a stdio session to the key's server; frames sent before the server proved its identity wait in the buffer. */
export function attachSharedSession(options: AttachSharedSessionOptions): SharedSession {
  const log = stderrLogger();
  let upstream: HttpUpstreamClient | undefined;
  let stopping: Promise<void> | undefined;
  const framer = createStdioFramer({
    input: options.input,
    output: options.output,
    log,
    onFrame: (frame) => fsm.enqueue(frame),
  });
  const fsm = createBridgeStateMachine({
    log,
    bufferSize: BUFFER_SIZE,
    reloadDeadlineMs: RELOAD_DEADLINE_MS,
    respond: (frame) => framer.write(frame),
    forward: async (frame) => {
      if (!upstream) throw new Error('the session has not reached its shared server');
      await upstream.send(frame);
    },
  });
  framer.start();
  fsm.onBootStart();

  const attached = connect(options, log).then(
    (server) => {
      if (stopping) return;
      upstream = createHttpUpstream({
        url: server.url,
        headers: { authorization: `Bearer ${server.token}` },
        fetch: server.fetch,
        log,
        onFrame: (frame) => fsm.relayUpstream(frame),
      });
      fsm.onChildReady();
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error('attach-failed', { error: message });
      fsm.onReloadDeadline({ error: message });
      throw error;
    },
  );
  attached.catch(() => undefined);

  async function shutdown(): Promise<void> {
    await fsm.stop();
    await upstream?.endSession();
    await upstream?.close();
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
