import {FrontMcpConfigType, FrontMcpInterface, FrontMcpServer} from '@frontmcp/sdk';
import {ScopeRegistry} from '../scope/scope.registry';
import ProviderRegistry from '../provider/provider.registry';
import {createMcpGlobalProviders} from './front-mcp.providers';
import LoggerRegistry from '../logger/logger.registry';

export class FrontMcpInstance implements FrontMcpInterface {
  config: FrontMcpConfigType;
  readonly ready: Promise<void>;

  private logger: LoggerRegistry;
  private providers: ProviderRegistry;
  private scopes: ScopeRegistry;

  constructor(config: FrontMcpConfigType) {
    this.config = config;
    this.ready = this.initialize();
  }

  async initialize(): Promise<void> {

    this.providers = new ProviderRegistry([
      ...createMcpGlobalProviders(this.config),
    ]);
    await this.providers.ready;

    this.logger = new LoggerRegistry(this.providers);
    await this.logger.ready;

    this.scopes = new ScopeRegistry(this.providers);
    await this.scopes.ready;

  }

  start() {
    const server = this.providers.get(FrontMcpServer);
    if (!server) {
      throw new Error('Server not found');
    }
    server.start();
  }

  public static async bootstrap(options: FrontMcpConfigType) {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;

    frontMcp.start();
  }
}
