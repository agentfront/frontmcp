/**
 * @file health.probes.ts
 * @description Factory functions that create HealthProbe instances from known infrastructure.
 */

import type { HealthCheckResult } from '../remote-mcp/resilience/health-check';
import type { HealthProbe, HealthProbeResult } from './health.types';

/** Safely extract an error message from an unknown thrown value. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================
// STORAGE PROBE
// ============================================

/**
 * Pingable interface — any object exposing a `ping()` method.
 * Matches BaseStorageAdapter, SessionStore, etc.
 */
export interface Pingable {
  ping(): Promise<boolean>;
}

/**
 * Creates a probe that calls `adapter.ping()` with timing.
 * Works with any object exposing a `ping(): Promise<boolean>` method.
 */
export function createStorageProbe(name: string, adapter: Pingable): HealthProbe {
  return {
    name,
    async check(): Promise<HealthProbeResult> {
      const start = Date.now();
      try {
        const ok = await adapter.ping();
        const latencyMs = Date.now() - start;
        return {
          status: ok ? 'healthy' : 'unhealthy',
          latencyMs,
          ...(!ok ? { error: 'Ping returned false' } : {}),
        };
      } catch (err) {
        return {
          status: 'unhealthy',
          latencyMs: Date.now() - start,
          error: getErrorMessage(err),
        };
      }
    },
  };
}

// ============================================
// REMOTE APP PROBE
// ============================================

/**
 * Provider of health check results for a remote app.
 * Matches `McpClientService.getHealthStatus()`.
 */
export interface HealthResultProvider {
  getHealthStatus(appId: string): HealthCheckResult | undefined;
}

/**
 * Creates a probe that reads the last health check result from the
 * existing HealthCheckManager. No redundant network call — reuses
 * the periodic background health check data.
 */
export function createRemoteAppProbe(appId: string, provider: HealthResultProvider): HealthProbe {
  return {
    name: `remote:${appId}`,
    async check(): Promise<HealthProbeResult> {
      const result = provider.getHealthStatus(appId);
      // No completed check yet is "unknown", not "down": reporting it unhealthy
      // made /readyz answer 503 for the first health-check interval (#646).
      if (!result || (result.status === 'unknown' && result.consecutiveFailures === 0)) {
        return { status: 'degraded', details: { state: 'unknown' } };
      }
      return {
        status: result.status === 'healthy' ? 'healthy' : result.status === 'degraded' ? 'degraded' : 'unhealthy',
        latencyMs: result.latencyMs,
        ...(result.error ? { error: result.error } : {}),
      };
    },
  };
}

// ============================================
// TRANSPORT SESSION STORE PROBE
// ============================================

/**
 * Provider of session store ping.
 * Matches the public API added to TransportService.
 */
export interface SessionStorePingProvider {
  pingSessionStore(): Promise<boolean>;
}

/**
 * Creates a probe that pings the transport session store.
 */
export function createTransportSessionProbe(provider: SessionStorePingProvider): HealthProbe {
  return {
    name: 'session-store',
    async check(): Promise<HealthProbeResult> {
      const start = Date.now();
      try {
        const ok = await provider.pingSessionStore();
        const latencyMs = Date.now() - start;
        return {
          status: ok ? 'healthy' : 'unhealthy',
          latencyMs,
          ...(!ok ? { error: 'Session store ping returned false' } : {}),
        };
      } catch (err) {
        return {
          status: 'unhealthy',
          latencyMs: Date.now() - start,
          error: getErrorMessage(err),
        };
      }
    },
  };
}
