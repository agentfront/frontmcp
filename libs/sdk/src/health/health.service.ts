/**
 * @file health.service.ts
 * @description Core health and readiness orchestrator.
 */

import { sha256Hex, getRuntimeContext } from '@frontmcp/utils';
import type { HealthOptionsInterface, ServerInfoOptions, HealthProbeDefinition } from '../common';
import type { HealthProbe, HealthzResponse, ReadyzResponse, CatalogInfo, HealthProbeResult } from './health.types';
import { createTransportSessionProbe, createRemoteAppProbe } from './health.probes';

const processStartTime = Date.now();

/**
 * Minimal scope interface for auto-discovery.
 * Avoids importing the full Scope class to prevent circular dependencies.
 */
export interface HealthScopeView {
  readonly transportService: {
    pingSessionStore(): Promise<boolean>;
  };
  readonly tools: {
    getTools(includeHidden?: boolean): Array<{ name: string }>;
  };
  readonly resources: {
    getResources(includeHidden?: boolean): unknown[];
  };
  readonly prompts: {
    getPrompts(includeHidden?: boolean): unknown[];
  };
  readonly skills: {
    getSkills(includeHidden?: boolean): unknown[];
  };
  readonly agents: {
    getAgents(): unknown[];
  };
  readonly apps: {
    getApps(): Array<{
      readonly id: string;
      readonly isRemote: boolean;
      getMcpClient?(): { getHealthStatus(appId: string): unknown };
    }>;
  };
}

export class HealthService {
  private readonly probes: HealthProbe[] = [];
  private readonly config: HealthOptionsInterface;
  private readonly serverInfo: ServerInfoOptions;
  private scopeView?: HealthScopeView;

  constructor(config: HealthOptionsInterface, serverInfo: ServerInfoOptions) {
    this.config = config;
    this.serverInfo = serverInfo;
  }

  // ============================================
  // PROBE REGISTRATION
  // ============================================

  /**
   * Register a health probe.
   */
  registerProbe(probe: HealthProbe): void {
    this.probes.push(probe);
  }

  /**
   * Auto-discover and register probes from scope infrastructure.
   *
   * Walks the scope's stores and registries to create built-in probes:
   * - Session store (if transport persistence is configured)
   * - Remote MCP apps (via existing HealthCheckManager)
   * - User-defined probes from config
   */
  autoDiscoverProbes(scope: HealthScopeView): void {
    this.scopeView = scope;

    // Session store probe
    if (scope.transportService) {
      this.registerProbe(createTransportSessionProbe(scope.transportService));
    }

    // Remote app probes
    for (const app of scope.apps.getApps()) {
      if (app.isRemote && typeof app.getMcpClient === 'function') {
        const client = app.getMcpClient();
        if (client && typeof client.getHealthStatus === 'function') {
          this.registerProbe(createRemoteAppProbe(app.id, client as { getHealthStatus(appId: string): any }));
        }
      }
    }

    // User-defined probes
    const userProbes = (this.config.probes ?? []) as HealthProbeDefinition[];
    for (const probe of userProbes) {
      if (probe && typeof probe.check === 'function' && typeof probe.name === 'string') {
        this.registerProbe({ name: probe.name, check: () => probe.check() });
      }
    }
  }

  // ============================================
  // HEALTHZ (LIVENESS)
  // ============================================

  /**
   * Get liveness response. Synchronous, no I/O.
   */
  getHealthz(): HealthzResponse {
    const ctx = getRuntimeContext();
    return {
      status: 'ok',
      server: {
        name: this.serverInfo.name ?? 'unknown',
        version: this.serverInfo.version ?? 'unknown',
      },
      runtime: {
        platform: ctx.platform,
        runtime: ctx.runtime,
        deployment: ctx.deployment,
        env: ctx.env,
      },
      uptime: (Date.now() - processStartTime) / 1000,
    };
  }

  // ============================================
  // READYZ (READINESS)
  // ============================================

  /**
   * Get readiness response. Runs all probes in parallel with per-probe timeout.
   */
  async getReadyz(): Promise<ReadyzResponse> {
    const start = Date.now();
    const timeoutMs = this.config.readyz?.timeoutMs ?? 5000;
    const includeDetails = this.resolveIncludeDetails();

    // Run all probes in parallel with timeout
    const results = await Promise.all(
      this.probes.map(async (probe) => {
        const result = await this.runProbeWithTimeout(probe, timeoutMs);
        return { name: probe.name, result };
      }),
    );

    // Compute aggregate status
    const hasUnhealthy = results.some((r) => r.result.status === 'unhealthy');
    const catalog = this.computeCatalogInfo();

    const response: ReadyzResponse = {
      status: hasUnhealthy ? 'not_ready' : 'ready',
      totalLatencyMs: Date.now() - start,
      catalog,
    };

    if (includeDetails) {
      const probes: Record<string, HealthProbeResult> = {};
      for (const { name, result } of results) {
        probes[name] = result;
      }
      response.probes = probes;
    }

    return response;
  }

  /**
   * Get the number of registered probes.
   */
  getProbeCount(): number {
    return this.probes.length;
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private async runProbeWithTimeout(probe: HealthProbe, timeoutMs: number): Promise<HealthProbeResult> {
    try {
      const timeoutPromise = new Promise<HealthProbeResult>((resolve) => {
        setTimeout(
          () =>
            resolve({
              status: 'unhealthy',
              latencyMs: timeoutMs,
              error: `Probe timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
      });

      return await Promise.race([probe.check(), timeoutPromise]);
    } catch (err) {
      return {
        status: 'unhealthy',
        error: (err as Error).message,
      };
    }
  }

  private computeCatalogInfo(): CatalogInfo {
    if (!this.scopeView) {
      return {
        toolsHash: '',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        skillCount: 0,
        agentCount: 0,
      };
    }

    const tools = this.scopeView.tools.getTools(true);
    const toolNames = tools.map((t) => t.name).sort();
    const toolsHash = sha256Hex(toolNames.join(','));

    return {
      toolsHash,
      toolCount: tools.length,
      resourceCount: this.scopeView.resources.getResources().length,
      promptCount: this.scopeView.prompts.getPrompts().length,
      skillCount: this.scopeView.skills.getSkills().length,
      agentCount: this.scopeView.agents.getAgents().length,
    };
  }

  private resolveIncludeDetails(): boolean {
    if (this.config.includeDetails !== undefined) {
      return this.config.includeDetails;
    }
    const ctx = getRuntimeContext();
    return ctx.env !== 'production';
  }
}
