import { getRuntimeContext } from '@frontmcp/utils';

import { ExpressHostAdapter } from '#express-host';

import {
  FrontMcpServer,
  type CorsOptions,
  type HttpMethod,
  type HttpOptions,
  type ServerRequestHandler,
} from '../common';
import { type HealthOptionsInterface } from '../common/types/options/health';
import { registerHealthRoutes, type HealthService } from '../health';
import { type HostServerAdapter } from './adapters/base.host.adapter';
import { auditSecurityDefaults, logSecurityFindings, resolveBindAddress } from './security/security-audit';

const DEFAULT_CORS: CorsOptions = { origin: true, credentials: false };

export class FrontMcpServerInstance extends FrontMcpServer {
  config: HttpOptions;
  host: HostServerAdapter;
  private healthRouteRegistered = false;
  private _healthService?: HealthService;
  private _healthConfig?: HealthOptionsInterface;

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
      this.host = new ExpressHostAdapter({
        ...(corsConfig ? { cors: corsConfig } : {}),
        ...(this.config.security ? { security: this.config.security } : {}),
      });
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

  /**
   * Set the health service and config for route registration.
   * Must be called before prepare() to enable enriched health endpoints.
   */
  setHealthService(healthService: HealthService, healthConfig: HealthOptionsInterface): void {
    this._healthService = healthService;
    this._healthConfig = healthConfig;
  }

  /**
   * Set health config without a service (e.g., when health is explicitly disabled).
   * Allows prepare() to distinguish "not configured" from "disabled".
   */
  setHealthConfig(healthConfig: HealthOptionsInterface): void {
    this._healthConfig = healthConfig;
  }

  prepare() {
    if (!this.healthRouteRegistered) {
      this.healthRouteRegistered = true;
      if (this._healthService && this._healthConfig) {
        // Enriched health/readiness endpoints
        registerHealthRoutes(this, this._healthService, this._healthConfig);
      } else if (this._healthConfig?.enabled === false) {
        // Health explicitly disabled — no routes registered
      } else {
        // Legacy fallback: bare-bones /health endpoint (no health config wired)
        this.registerRoute('GET', '/health', async (req, res) => {
          res.status(200).json({ status: 'ok' });
        });
      }
    }
    this.host.prepare();
  }

  getHandler(): unknown {
    return this.host.getHandler();
  }

  async start() {
    this.prepare();

    const deploymentMode = getRuntimeContext().deployment;
    const bindAddress = resolveBindAddress(this.config.security, deploymentMode);

    // Run security audit (warns in production/distributed mode)
    const isProduction = process.env['NODE_ENV'] === 'production';
    const findings = auditSecurityDefaults(
      {
        cors: this.config.cors,
        security: this.config.security,
        resolvedBindAddress: bindAddress,
        deploymentMode,
      },
      isProduction,
    );
    logSecurityFindings(findings, console);

    await this.host.start(this.config.socketPath ?? this.config.port, bindAddress);
  }
}
