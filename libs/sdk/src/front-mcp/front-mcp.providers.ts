import { ProviderScope } from '@frontmcp/di';

import { AsyncProvider, FrontMcpServer, type FrontMcpConfigType, type ProviderValueType } from '../common';
import { FrontMcpContextStorage } from '../context';
import { NoopFrontMcpServer } from '../server/noop-server';
import { FrontMcpServerInstance } from '../server/server.instance';
import { FrontMcpConfig } from './front-mcp.tokens';

const frontMcpConfig = {
  with: (metadata: FrontMcpConfigType): ProviderValueType<FrontMcpConfigType> => ({
    name: 'frontmcp:config',
    provide: FrontMcpConfig,
    scope: ProviderScope.GLOBAL,
    useValue: metadata,
  }),
};

// bodyLimit must be included to satisfy the resolved `HttpOptions` shape —
// the schema's `.default('4mb')` makes it non-optional in the output type.
// Adapter falls back to the same value when undefined, so the runtime
// behaviour is unchanged either way (fix for CI build break on PR #422).
const DEFAULT_HTTP_OPTIONS = { port: Number(process.env['PORT']) || 3000, entryPath: '/mcp', bodyLimit: '4mb' };

const frontMcpServer = AsyncProvider({
  name: 'frontmcp:server',
  scope: ProviderScope.GLOBAL,
  provide: FrontMcpServer,
  inject: () => [FrontMcpConfig],
  useFactory: (config) => {
    return new FrontMcpServerInstance(config.http ?? DEFAULT_HTTP_OPTIONS);
  },
});

/** Lightweight server provider for CLI mode — skips Express/CORS import overhead. */
const noopServer: ProviderValueType<FrontMcpServer> = {
  name: 'frontmcp:server:noop',
  provide: FrontMcpServer,
  scope: ProviderScope.GLOBAL,
  useValue: new NoopFrontMcpServer(),
};

export function createMcpGlobalProviders(metadata: FrontMcpConfigType) {
  const isCli = !!(metadata as Record<string, unknown>)['__cliMode'];
  const isNoServe = metadata.serve === false;
  const serverProvider = isCli || isNoServe ? noopServer : frontMcpServer;
  return [frontMcpConfig.with(metadata), serverProvider, FrontMcpContextStorage];
}
