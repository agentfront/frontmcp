import { FrontMcpServer, HttpConfig, HttpMethod, ServerRequestHandler } from '../common';
import { ExpressHostAdapter } from './adapters/express.host.adapter';
import { HostServerAdapter } from './adapters/base.host.adapter';


export class FrontMcpServerInstance extends FrontMcpServer {
  config: HttpConfig;
  host: HostServerAdapter;

  constructor(httpConfig: HttpConfig) {
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
      this.host = new ExpressHostAdapter();
    }
  }

  registerMiddleware(entryPath: string, handler: ServerRequestHandler) {
    return this.host.registerMiddleware(entryPath, handler);
  };

  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler) {
    return this.host.registerRoute(method, path, handler);
  };

  override enhancedHandler(handler: ServerRequestHandler): ServerRequestHandler {
    return this.host.enhancedHandler(handler);
  }

  start() {
    this.registerRoute('GET', '/health', async (req, res) => {
      res.status(200).json({
        status: 'ok',
      });
    })
    this.host.start(this.config.port);
  }
}
