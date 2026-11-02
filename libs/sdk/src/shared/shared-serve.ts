import * as net from 'node:net';

import { createSharedServerSecret, deriveSharedServerKeys, isStaticMode } from '@frontmcp/auth';
import { ProviderScope } from '@frontmcp/di';
import { watchPath } from '@frontmcp/utils';

import {
  frontMcpMetadataSchema,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type HttpOptionsInput,
  type ScopeEntry,
} from '../common';
import { InternalMcpError } from '../errors';
import { SharedServerStartError } from '../errors/shared-server.errors';
import { FileLogTransportInstance } from '../logger/instances/instance.file-logger';
import type { Scope } from '../scope/scope.instance';
import { deriveAllowedHosts } from '../server/security/resolve-allowed-hosts';
import SharedDrainFlow from './flows/shared.drain.flow';
import SharedIdentifyFlow from './flows/shared.identify.flow';
import { httpEndpoint, unixEndpoint } from './shared-endpoint';
import {
  assertSocketPathFits,
  prepareSharedDirectory,
  removeServerRecord,
  sharedServerFiles,
  writeServerRecord,
  type SharedServerFiles,
} from './shared-files';
import { SharedServerIdentity } from './shared-server.identity';
import { SharedServerLifecycle } from './shared-server.lifecycle';
import type { ResolvedSharedServerOptions } from './shared-server.options';
import { holdStartLock, type HeldStartLock } from './start-lock';

const LOOPBACK = '127.0.0.1';
const ANOTHER_START = 'another session is starting it';
const DRAIN_MS = 5_000;
/** How long an exiting server keeps answering `exiting` after it stopped taking requests, before it closes. */
const EXIT_GRACE_MS = 250;
const EXIT_DEADLINE_MS = 15_000;
const WATCH_INTERVAL_MS = 1_000;

/** The part of `FrontMcpInstance` a shared server runs. */
export interface SharedServerInstance {
  readonly ready: Promise<void>;
  start(): Promise<void>;
  emitProvidersReady(): Promise<void>;
  shutdown(): Promise<void>;
  getPrimaryScope(): ScopeEntry | undefined;
  getScopes(): ScopeEntry[];
}

export interface SharedServerHandle {
  /** Refuse new requests, remove the record, let the requests in flight finish, then shut the server down. */
  close(): Promise<void>;
}

/** A port nothing listens on now; a process that takes it first makes the listen fail, and gets no token. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, LOOPBACK, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** An owner-only socket, or loopback with Host checked against the loopback names and every Origin refused. */
function sharedHttpOptions(files: SharedServerFiles, port: number | undefined): HttpOptionsInput {
  if (port === undefined) return { socketPath: files.socketPath, cors: false };
  return {
    port,
    cors: false,
    security: {
      bindAddress: LOOPBACK,
      dnsRebindingProtection: {
        enabled: true,
        allowedHosts: deriveAllowedHosts({ bindAddress: LOOPBACK, port }),
        allowedOrigins: [],
      },
    },
  };
}

function withFileLogging(logging: FrontMcpConfigInput['logging']): FrontMcpConfigInput['logging'] {
  const transports = logging?.transports ?? [];
  return {
    ...logging,
    transports: transports.includes(FileLogTransportInstance) ? transports : [...transports, FileLogTransportInstance],
  };
}

/** Refuse an app with auth of its own: it would keep that auth, and answer requests that lack the token. */
export function assertTokenGuardsEveryScope(instance: SharedServerInstance, key: string, token: string): void {
  for (const scope of instance.getScopes()) {
    const auth = scope.auth.options;
    if (isStaticMode(auth) && auth.tokens.length === 1 && auth.tokens[0] === token) continue;
    throw new SharedServerStartError(
      key,
      `app "${scope.id}" has auth of its own (mode ${auth.mode}), which the shared server's token would not guard; ` +
        'remove auth from its @App, or serve it without runShared()',
    );
  }
}

export interface ServeSharedOptions {
  config: FrontMcpConfigInput;
  options: ResolvedSharedServerOptions;
  create: (config: FrontMcpConfigType) => SharedServerInstance;
  /** The holder of the start lock the session that started this server took. */
  startLockHolder?: string;
  /** Ends the process once the server exited on its own: drained, idle, or its checkout removed. */
  exit: (code: number) => void;
  /** How often it checks whether it is idle or its checkout is gone. @default 1000 */
  watchIntervalMs?: number;
}

/**
 * Serve `config` as the key's server, with static auth for a fresh secret's token, recorded once it listens. It
 * holds the key's start lock, taken over from the session that started it, until the record is written.
 */
export async function serveShared(serve: ServeSharedOptions): Promise<SharedServerHandle> {
  const { options } = serve;
  const files = sharedServerFiles(options.key);
  if (options.transport === 'unix') assertSocketPathFits(files);
  await prepareSharedDirectory(files);
  const startLock = await holdStartLock(files, options.key, serve.startLockHolder);
  try {
    if (!(await startLock.held())) throw new SharedServerStartError(options.key, ANOTHER_START);
    return await startSharedServer(serve, files, startLock);
  } finally {
    await startLock.release();
  }
}

async function startSharedServer(
  serve: ServeSharedOptions,
  files: SharedServerFiles,
  startLock: HeldStartLock,
): Promise<SharedServerHandle> {
  const { config, options } = serve;
  const secret = createSharedServerSecret();
  const keys = deriveSharedServerKeys(secret);
  const port = options.transport === 'http' ? await freeLoopbackPort() : undefined;
  const endpoint = port === undefined ? unixEndpoint(files.socketPath) : httpEndpoint(port);
  const lifecycle = new SharedServerLifecycle();
  const instance = serve.create(
    frontMcpMetadataSchema.parse({
      ...config,
      serve: true,
      http: sharedHttpOptions(files, port),
      auth: { mode: 'static', tokens: [keys.token] },
      logging: withFileLogging(config.logging),
      providers: [
        ...(config.providers ?? []),
        {
          name: 'frontmcp:shared-server-identity',
          provide: SharedServerIdentity,
          scope: ProviderScope.GLOBAL,
          useValue: new SharedServerIdentity(keys, endpoint.id, config.info.version),
        },
        {
          name: 'frontmcp:shared-server-lifecycle',
          provide: SharedServerLifecycle,
          scope: ProviderScope.GLOBAL,
          useValue: lifecycle,
        },
      ],
    }),
  );
  await instance.ready;
  let scope: Scope;
  try {
    const primary = instance.getPrimaryScope() as Scope | undefined;
    if (!primary) throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
    scope = primary;
    await scope.registryFlows(SharedIdentifyFlow, SharedDrainFlow);
    assertTokenGuardsEveryScope(instance, options.key, keys.token);
    await instance.start();
    if (!(await startLock.held())) throw new SharedServerStartError(options.key, ANOTHER_START);
    await writeServerRecord(files, {
      transport: options.transport,
      ...(port === undefined ? {} : { port }),
      path: scope.fullPath || '/',
      pid: process.pid,
      secret,
    });
  } catch (error) {
    await instance.shutdown().catch(() => undefined);
    throw error;
  }
  return runUntilExit(serve, files, instance, scope, lifecycle);
}

/** Exit when idle past `idleTimeoutMs`, or once the checkout is removed; returns what stops watching. */
function watchForExit(serve: ServeSharedOptions, lifecycle: SharedServerLifecycle): () => void {
  const { idleTimeoutMs, checkout } = serve.options;
  const intervalMs = serve.watchIntervalMs ?? WATCH_INTERVAL_MS;
  const stops: Array<() => void> = [];
  if (idleTimeoutMs !== false) {
    const startedAt = Date.now();
    const timer = setInterval(
      () => {
        if (Math.min(lifecycle.idleFor(), Date.now() - startedAt) < idleTimeoutMs) return;
        lifecycle.exit(`it had no request for ${idleTimeoutMs} ms`);
      },
      Math.min(intervalMs, idleTimeoutMs),
    );
    timer.unref();
    stops.push(() => clearInterval(timer));
  }
  if (checkout !== false) {
    const watcher = watchPath(checkout, {
      intervalMs,
      onGone: () => lifecycle.exit(`its checkout ${checkout} was removed`),
    });
    stops.push(() => watcher.close());
  }
  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Serve until asked to exit: by a newer session, when idle, when the checkout is removed, or by `close()`. It then
 * refuses new requests, removes its record, gives the requests in flight time to finish, and shuts down.
 */
function runUntilExit(
  serve: ServeSharedOptions,
  files: SharedServerFiles,
  instance: SharedServerInstance,
  scope: Scope,
  lifecycle: SharedServerLifecycle,
): SharedServerHandle {
  const stopWatching = watchForExit(serve, lifecycle);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      lifecycle.exit('it was stopped');
      stopWatching();
      await removeServerRecord(files, process.pid).catch(() => undefined);
      await Promise.all([lifecycle.settled(DRAIN_MS), new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
      await instance.shutdown();
    })();
    return closing;
  };
  void lifecycle.exiting.then((reason) => {
    if (closing) return;
    scope.logger.info(`The shared server "${serve.options.key}" exits: ${reason}`);
    const deadline = setTimeout(() => serve.exit(1), EXIT_DEADLINE_MS);
    close().then(
      () => {
        clearTimeout(deadline);
        serve.exit(0);
      },
      () => {
        clearTimeout(deadline);
        serve.exit(1);
      },
    );
  });
  return { close };
}
