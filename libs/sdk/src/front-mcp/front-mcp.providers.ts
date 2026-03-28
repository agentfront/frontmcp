import { ProviderScope } from '@frontmcp/di';
import { FrontMcpConfigType, FrontMcpServer, ProviderValueType, AsyncProvider } from '../common';
import { FrontMcpServerInstance } from '../server/server.instance';
import { NoopFrontMcpServer } from '../server/noop-server';
import { FrontMcpConfig } from './front-mcp.tokens';
import { FrontMcpContextStorage } from '../context';

const frontMcpConfig = {
  with: (metadata: FrontMcpConfigType): ProviderValueType<FrontMcpConfigType> => ({
    name: 'frontmcp:config',
    provide: FrontMcpConfig,
    scope: ProviderScope.GLOBAL,
    useValue: metadata,
  }),
};

const DEFAULT_HTTP_OPTIONS = { port: Number(process.env['PORT']) || 3000, entryPath: '/mcp' };

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
