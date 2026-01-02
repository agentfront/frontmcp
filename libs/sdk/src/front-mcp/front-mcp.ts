import { FrontMcpConfigType, FrontMcpInterface, FrontMcpServer, ScopeEntry } from '../common';
import { ScopeRegistry } from '../scope/scope.registry';
import ProviderRegistry from '../provider/provider.registry';
import { createMcpGlobalProviders } from './front-mcp.providers';
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
    this.providers = new ProviderRegistry([...createMcpGlobalProviders(this.config)]);
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

  /**
   * Get the configuration used to create this FrontMCP instance.
   */
  getConfig(): FrontMcpConfigType {
    return this.config;
  }

  /**
   * Get all initialized scope instances.
   * Useful for graph visualization and introspection.
   */
  getScopes(): ScopeEntry[] {
    return this.scopes.getScopes();
  }

  public static async bootstrap(options: FrontMcpConfigType) {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;

    frontMcp.start();
  }

  /**
   * Creates and initializes a FrontMCP instance without starting the HTTP server.
   * Returns the underlying HTTP handler for serverless deployments (Vercel, Lambda).
   *
   * @example
   * // In index.ts for Vercel
   * import { FrontMcpInstance } from '@frontmcp/sdk';
   * import config from '../src/main';
   *
   * export default FrontMcpInstance.createHandler(config);
   */
  public static async createHandler(options: FrontMcpConfigType): Promise<unknown> {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;

    const server = frontMcp.providers.get(FrontMcpServer);
    if (!server) {
      throw new Error('Server not found');
    }

    server.prepare();
    return server.getHandler();
  }

  /**
   * Creates and initializes a FrontMCP instance without starting any server.
   * Returns the instance for graph extraction and introspection purposes.
   *
   * @example
   * // For graph visualization
   * const instance = await FrontMcpInstance.createForGraph(config);
   * const scopes = instance.getScopes();
   */
  public static async createForGraph(options: FrontMcpConfigType): Promise<FrontMcpInstance> {
    const frontMcp = new FrontMcpInstance(options);
    await frontMcp.ready;
    return frontMcp;
  }
}
