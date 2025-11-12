import {
  FrontMcpConfigType,
  ProviderScope,
  FrontMcpServer,
  ProviderValueType,  AsyncProvider,
} from '../common';
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

const frontMcpServer = AsyncProvider({
  name: 'frontmcp:server',
  scope: ProviderScope.GLOBAL,
  provide: FrontMcpServer,
  inject: () => [FrontMcpConfig],
  useFactory: (config) => {
    return new FrontMcpServerInstance(config.http);
  },
});

export function createMcpGlobalProviders(metadata: FrontMcpConfigType) {
  return [
    frontMcpConfig.with(metadata),
    frontMcpServer,
  ];
}
