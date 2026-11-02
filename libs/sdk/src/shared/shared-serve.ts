import * as net from 'node:net';

import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';
import { ProviderScope } from '@frontmcp/di';

import {
  frontMcpMetadataSchema,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type HttpOptionsInput,
  type ScopeEntry,
} from '../common';
import { InternalMcpError } from '../errors';
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

const LOOPBACK = '127.0.0.1';

/** The part of `FrontMcpInstance` a shared server runs. */
export interface SharedServerInstance {
  readonly ready: Promise<void>;
  start(): Promise<void>;
  shutdown(): Promise<void>;
  getPrimaryScope(): ScopeEntry | undefined;
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

/** Serve `config` as the key's server, with static auth for a fresh secret's token, recorded once it listens. */
export async function serveShared(
  config: FrontMcpConfigInput,
  options: ResolvedSharedServerOptions,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<SharedServerHandle> {
  const files = sharedServerFiles(options.key);
  if (options.transport === 'unix') assertSocketPathFits(files);
  await prepareSharedDirectory(files);
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
    await instance.start();
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
