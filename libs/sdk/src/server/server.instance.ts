import { FrontMcpServer, HttpOptions, HttpMethod, ServerRequestHandler, CorsOptions } from '../common';
import { ExpressHostAdapter } from './adapters/express.host.adapter';
import { HostServerAdapter } from './adapters/base.host.adapter';

const DEFAULT_CORS: CorsOptions = { origin: true, credentials: false };

export class FrontMcpServerInstance extends FrontMcpServer {
  config: HttpOptions;
  host: HostServerAdapter;
  private healthRouteRegistered = false;

  constructor(httpConfig: HttpOptions) {
    super();
    this.config = httpConfig;
    this.setupDefaults();
  }

  private setupDefaults() {
    if (typeof this.config.hostFactory === 'function') {
      const { hostFactory, ...config } = this.config;
      this.host = this.config.hostFactory(config);
    } else if (this.config.hostFactory !== undefined) {
      this.host = this.config.hostFactory;
    } else {
      const corsConfig = this.config.cors === false ? undefined : (this.config.cors ?? DEFAULT_CORS);
      this.host = new ExpressHostAdapter(corsConfig ? { cors: corsConfig } : undefined);
    }
  }

  registerMiddleware(entryPath: string, handler: ServerRequestHandler) {
    return this.host.registerMiddleware(entryPath, handler);
  }

  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler) {
    return this.host.registerRoute(method, path, handler);
  }

  override enhancedHandler(handler: ServerRequestHandler): ServerRequestHandler {
    return this.host.enhancedHandler(handler);
  }

  prepare() {
    if (!this.healthRouteRegistered) {
      this.healthRouteRegistered = true;
      this.registerRoute('GET', '/health', async (req, res) => {
        res.status(200).json({ status: 'ok' });
      });
    }
    this.host.prepare();
  }

  getHandler(): unknown {
    return this.host.getHandler();
  }

  async start() {
    this.prepare();
    await this.host.start(this.config.socketPath ?? this.config.port);
  }
}
