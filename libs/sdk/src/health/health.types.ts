/**
 * @file health.types.ts
 * @description Runtime types for the health and readiness system.
 */

import type { HealthProbeResult } from '../common/types/options/health';

// Re-export for convenience
export type { HealthProbeResult };

// ============================================
// HEALTH PROBE
// ============================================

/**
 * Internal health probe contract.
 * Used by both auto-discovered and user-defined probes.
 */
export interface HealthProbe {
  /** Unique probe name (appears in /readyz response) */
  readonly name: string;
  /** Execute the health check and return the result */
  check(): Promise<HealthProbeResult>;
}

// ============================================
// CATALOG INFO
// ============================================

/**
 * Catalog introspection snapshot included in readiness responses.
 */
export interface CatalogInfo {
  /** SHA-256 hex hash of sorted tool names for config drift detection */
  toolsHash: string;
  /** Number of registered tools */
  toolCount: number;
  /** Number of registered resources */
  resourceCount: number;
  /** Number of registered prompts */
  promptCount: number;
  /** Number of registered skills */
  skillCount: number;
  /** Number of registered agents */
  agentCount: number;
}

// ============================================
// HEALTHZ RESPONSE
// ============================================

/**
 * Response shape for the `/healthz` liveness probe.
 */
export interface HealthzResponse {
  /** 'ok' when the server process is alive */
  status: 'ok' | 'error';
  /** Server identification */
  server: {
    name: string;
    version: string;
  };
  /** Runtime environment snapshot */
  runtime: {
    platform: string;
    runtime: string;
    deployment: string;
    env: string;
  };
  /** Server uptime in seconds */
  uptime: number;
  /** Error message when status is 'error' */
  error?: string;
}

// ============================================
// READYZ RESPONSE
// ============================================

/**
 * Response shape for the `/readyz` readiness probe.
 */
export interface ReadyzResponse {
  /** 'ready' when all probes pass, 'not_ready' when at least one fails */
  status: 'ready' | 'not_ready';
  /** Total time to execute all probes in milliseconds */
  totalLatencyMs: number;
  /** Catalog introspection snapshot */
  catalog: CatalogInfo;
  /** Per-probe results (omitted when includeDetails is false) */
  probes?: Record<string, HealthProbeResult>;
}
