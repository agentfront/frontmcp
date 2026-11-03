import { createSharedServerSecret, deriveSharedServerKeys } from '@frontmcp/auth';

import { frontMcpMetadataSchema, type FrontMcpConfigInput, type FrontMcpConfigType } from '../common';
import { InternalMcpError } from '../errors';
import type { Scope } from '../scope/scope.instance';
import { createServerFetchHandler } from '../transport/web-fetch-handler';
import { assertTokenGuardsEveryScope, type SharedServerInstance } from './shared-serve';

/** The server a session runs in its own process, reached through the same HTTP flows as the shared one. */
export interface EmbeddedSharedServer {
  url: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  close(): Promise<void>;
}

/** Run `config` in this process as the key's shared server would run it: static auth for a fresh token, no listener. */
export async function runEmbeddedServer(
  config: FrontMcpConfigInput,
  key: string,
  create: (config: FrontMcpConfigType) => SharedServerInstance,
): Promise<EmbeddedSharedServer> {
  const { token } = deriveSharedServerKeys(createSharedServerSecret());
  const instance = create(
    frontMcpMetadataSchema.parse({ ...config, serve: false, auth: { mode: 'static', tokens: [token] } }),
  );
  await instance.ready;
  try {
    const scope = instance.getPrimaryScope() as Scope | undefined;
    if (!scope) throw new InternalMcpError('No scopes initialized. Ensure at least one app is configured.');
    assertTokenGuardsEveryScope(instance, key, token);
    await instance.emitProvidersReady();
    const handler = createServerFetchHandler(scope, instance.getScopes() as Scope[]);
    return {
      url: `http://localhost${scope.fullPath || '/'}`,
      headers: { authorization: `Bearer ${token}` },
      fetch: (input, init) => handler(new Request(input, init)),
      close: () => instance.shutdown(),
    };
  } catch (error) {
    await instance.shutdown().catch(() => undefined);
    throw error;
  }
}
