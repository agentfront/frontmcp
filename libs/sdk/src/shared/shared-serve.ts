import * as net from 'node:net';

import { createSharedServerSecret, deriveSharedServerKeys, isStaticMode } from '@frontmcp/auth';
import { ProviderScope } from '@frontmcp/di';

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
import type { ResolvedSharedServerOptions } from './shared-server.options';
import { holdStartLock, type HeldStartLock } from './start-lock';

const LOOPBACK = '127.0.0.1';
const ANOTHER_START = 'another session is starting it';

/** The part of `FrontMcpInstance` a shared server runs. */
export interface SharedServerInstance {
  readonly ready: Promise<void>;
  start(): Promise<void>;
  shutdown(): Promise<void>;
  getPrimaryScope(): ScopeEntry | undefined;
  getScopes(): ScopeEntry[];
}

export interface SharedServerHandle {
  /** Remove the record, then shut the server down. */
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
function assertTokenGuardsEveryScope(instance: SharedServerInstance, key: string, token: string): void {
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

/**
 * Serve `config` as the key's server, with static auth for a fresh secret's token, recorded once it listens. It
 * holds the key's start lock, taken over from the session that started it, until the record is written.
 */
export async function serveShared(
  config: FrontMcpConfigInput,
  options: ResolvedSharedServerOptions,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
  startLockHolder?: string,
): Promise<SharedServerHandle> {
  const files = sharedServerFiles(options.key);
  if (options.transport === 'unix') assertSocketPathFits(files);
  await prepareSharedDirectory(files);
  const startLock = await holdStartLock(files, options.key, startLockHolder);
  try {
    if (!(await startLock.held())) throw new SharedServerStartError(options.key, ANOTHER_START);
    return await startSharedServer(config, options, create, files, startLock);
  } finally {
    await startLock.release();
  }
}

async function startSharedServer(
  config: FrontMcpConfigInput,
  options: ResolvedSharedServerOptions,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
  files: SharedServerFiles,
  startLock: HeldStartLock,
): Promise<SharedServerHandle> {
  const secret = createSharedServerSecret();
  const { proofKey, token } = deriveSharedServerKeys(secret);
  const port = options.transport === 'http' ? await freeLoopbackPort() : undefined;
  const endpoint = port === undefined ? unixEndpoint(files.socketPath) : httpEndpoint(port);
  const instance = create(
    frontMcpMetadataSchema.parse({
      ...config,
      serve: true,
      http: sharedHttpOptions(files, port),
      auth: { mode: 'static', tokens: [token] },
      logging: withFileLogging(config.logging),
      providers: [
        ...(config.providers ?? []),
        {
          name: 'frontmcp:shared-server-identity',
          provide: SharedServerIdentity,
          scope: ProviderScope.GLOBAL,
          useValue: new SharedServerIdentity(proofKey, endpoint.id),
        },
      ],
    }),
  );
  await instance.ready;
  const scope = instance.getPrimaryScope() as Scope | undefined;
  if (!scope) throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
  await scope.registryFlows(SharedIdentifyFlow);
  try {
    assertTokenGuardsEveryScope(instance, options.key, token);
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
  return {
    close: async () => {
      await removeServerRecord(files, process.pid);
      await instance.shutdown();
    },
  };
}
