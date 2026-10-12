import { ProviderScope } from '@frontmcp/di';

import {
  AsyncProvider,
  defaultHttpPort,
  FrontMcpServer,
  type FrontMcpConfigType,
  type ProviderType,
  type ProviderValueType,
} from '../common';
import { FrontMcpContextStorage } from '../context';
import { NoopFrontMcpServer } from '../server/noop-server';
import { FrontMcpConfig } from './front-mcp.tokens';

const frontMcpConfig = {
  with: (metadata: FrontMcpConfigType): ProviderValueType<FrontMcpConfigType> => ({
    name: 'frontmcp:config',
    provide: FrontMcpConfig,
    scope: ProviderScope.GLOBAL,
    useValue: metadata,
  }),
};

// Built when the server is created, not when this module loads: a browser bundle has no
// `process` to read PORT from at load (#681).
const defaultHttpOptions = () => ({ port: defaultHttpPort(), entryPath: '/mcp' });

const frontMcpServer = AsyncProvider({
  name: 'frontmcp:server',
  scope: ProviderScope.GLOBAL,
  provide: FrontMcpServer,
  inject: () => [FrontMcpConfig],
  useFactory: async (config) => {
    const { FrontMcpServerInstance } = await import('../server/server.instance.js');
    return new FrontMcpServerInstance(config.http ?? defaultHttpOptions());
  },
});

/** Lightweight server provider for CLI mode — skips Express/CORS import overhead. */
const noopServer: ProviderValueType<FrontMcpServer> = {
  name: 'frontmcp:server:noop',
  provide: FrontMcpServer,
  scope: ProviderScope.GLOBAL,
  useValue: new NoopFrontMcpServer(),
};

export function createMcpGlobalProviders(metadata: FrontMcpConfigType): ProviderType[] {
  const isCli = !!(metadata as Record<string, unknown>)['__cliMode'];
  const isNoServe = metadata.serve === false;
  const serverProvider = isCli || isNoServe ? noopServer : frontMcpServer;
  return [frontMcpConfig.with(metadata), serverProvider, FrontMcpContextStorage];
}
