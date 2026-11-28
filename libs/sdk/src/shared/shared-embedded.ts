import * as path from 'node:path';

import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';
import { randomBytes } from '@frontmcp/utils';

import { frontMcpMetadataSchema, type FrontMcpConfigInput, type FrontMcpConfigType } from '../common';
import { InternalMcpError } from '../errors';
import { markEntryServer } from '../front-mcp/detached-job.flag';
import type { Scope } from '../scope/scope.instance';
import { createServerFetchHandler } from '../transport/web-fetch-handler';
import { httpEndpoint, unixEndpoint, type SharedEndpoint } from './shared-endpoint';
import { prepareSharedDirectory, sharedServerFiles, socketPathFits } from './shared-files';
import {
  assertTokenGuardsEveryScope,
  freeLoopbackPort,
  sharedHttpOptions,
  type SharedServerInstance,
} from './shared-serve';
import type { ResolvedSharedServerOptions } from './shared-server.options';

/** The server a session runs in its own process, reached through the same HTTP flows as the shared one. */
export interface EmbeddedSharedServer {
  url: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  close(): Promise<void>;
}

/** A server booted in the session's process, serving nothing yet: `start()` serves it, `close()` shuts it down. */
export interface BootedEmbeddedServer {
  start(): Promise<EmbeddedSharedServer>;
  close(): Promise<void>;
}

/** Where a session's own server listens: a socket of its own in the key's folder, or a loopback port. */
type EmbeddedListener = { socketPath: string; port?: undefined } | { port: number; socketPath?: undefined };

/**
 * A listener of the session's own: over the socket, a socket file of its own beside the key's server's, unless its
 * path is longer than a socket address holds; then none, and the server is served per request.
 */
async function embeddedListener(
  options: Pick<ResolvedSharedServerOptions, 'key' | 'transport'>,
): Promise<EmbeddedListener | undefined> {
  if (options.transport === 'http') return { port: await freeLoopbackPort() };
  const files = sharedServerFiles(options.key);
  const id = Buffer.from(randomBytes(4)).toString('hex');
  const socketPath = path.join(files.directory, `s-${id}.sock`);
  if (!socketPathFits(socketPath)) return undefined;
  await prepareSharedDirectory(files);
  return { socketPath };
}

function endpointOf(listener: EmbeddedListener): SharedEndpoint {
  return listener.port === undefined ? unixEndpoint(listener.socketPath) : httpEndpoint(listener.port);
}

/**
 * Boot `config` in this process as the key's shared server would run it: static auth for a fresh token, the routes and
 * people auth the config's `http` keeps, and a listener of its own (see {@link embeddedListener}), so its session gets
 * a notification stream as on the shared server. Nothing is served, and no `onReady()` runs, until `start()`.
 */
export async function bootEmbeddedServer(
  config: FrontMcpConfigInput,
  options: Pick<ResolvedSharedServerOptions, 'key' | 'transport'>,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<BootedEmbeddedServer> {
  const { token } = deriveSharedServerKeys(createSharedServerSecret());
  const listener = await embeddedListener(options);
  const parsed = frontMcpMetadataSchema.parse({
    ...config,
    serve: listener !== undefined,
    ...(listener ? { http: sharedHttpOptions(listener, config.http) } : {}),
    auth: { mode: 'static', tokens: [token] },
  });
  // A detached job's runner runs this entry again, which hands it over to its run (see `FrontMcpInstance.runShared`)
  markEntryServer(parsed);
  const instance = create(parsed);
  await instance.ready;
  let scope: Scope;
  try {
    const primary = instance.getPrimaryScope() as Scope | undefined;
    if (!primary) throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
    scope = primary;
    assertTokenGuardsEveryScope(instance, options.key, token);
  } catch (error) {
    await instance.shutdown().catch(() => undefined);
    throw error;
  }
  const headers = { authorization: `Bearer ${token}` };
  const close = () => instance.shutdown();
  let started: Promise<EmbeddedSharedServer> | undefined;
  const serve = async (): Promise<EmbeddedSharedServer> => {
    try {
      if (!listener) {
        await instance.emitProvidersReady();
        const handler = createServerFetchHandler(scope, instance.getScopes() as Scope[]);
        const fetchHandled: typeof fetch = (input, init) => handler(new Request(input, init));
        return { url: `http://localhost${scope.fullPath || '/'}`, headers, fetch: fetchHandled, close };
      }
      await instance.start();
      const endpoint = endpointOf(listener);
      return { url: `${endpoint.baseUrl}${scope.fullPath || '/'}`, headers, fetch: endpoint.fetch, close };
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  };
  return {
    start: () => (started ??= serve()),
    close,
  };
}
