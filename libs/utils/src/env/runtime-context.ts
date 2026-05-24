/**
 * Runtime context detection and entry availability matching (Node.js version).
 *
 * Provides:
 * - `RuntimeContext` — snapshot of the current platform, runtime, deployment, env, provider, target
 * - `EntryAvailability` — declarative constraint for when an entry is available
 * - `getRuntimeContext()` — lazy singleton returning the detected context
 * - `isEntryAvailable()` — pure matcher: does the constraint match the context?
 * - `checkEntryAvailability()` — structured matcher returning `{available, missingAxes}`
 *
 * Issue #417 adds:
 *   - `os` as the new name for `platform` (alias preserved for back-compat)
 *   - `provider` (vercel / lambda / cloudflare / netlify / docker / bare / …)
 *   - `target` (the build output produced by `frontmcp build --target <x>`)
 *   - `surface` (per-call axis: mcp / cli / agent / job / http-trigger)
 */

import { z } from '@frontmcp/lazy-zod';

import { isEdgeRuntime, isServerless } from '#env';

import { getBuildTarget } from './build-target';
import { detectProvider } from './provider';

// ============================================
// Types
// ============================================

/**
 * Snapshot of the current runtime environment. Detected once and cached
 * for the lifetime of the process.
 */
export interface RuntimeContext {
  /** OS platform: 'darwin', 'linux', 'win32', etc. (issue #417: renamed from platform) */
  os: string;
  /** @deprecated Use `os` instead. Legacy alias preserved for back-compat. */
  platform: string;
  /** JavaScript runtime: 'node', 'bun', 'deno', 'edge', 'browser' */
  runtime: string;
  /** Deployment mode: 'distributed', 'serverless', 'standalone', or 'browser' */
  deployment: string;
  /** Deploy provider (issue #417): 'vercel', 'lambda', 'cloudflare', 'docker', 'bare', … */
  provider: string;
  /** Build target produced by `frontmcp build` (issue #417). `'unknown'` in dev. */
  target: string;
  /** NODE_ENV value: 'production', 'development', 'test', etc. */
  env: string;
}

/**
 * Per-call surface — `surface` is the only axis that varies per request.
 * Set by transport adapters / agent dispatchers / job runners on the
 * outgoing `ctx` so registry filtering can fork on call origin.
 */
export type Surface = 'mcp' | 'cli' | 'http-trigger' | 'job' | 'agent';

/** Call-context wrapper threaded through `findTool` for per-call filtering. */
export interface CallContext {
  surface?: Surface;
}

/**
 * Declarative constraint for entry availability.
 *
 * Semantics:
 * - AND across fields: all specified fields must match
 * - OR within arrays: at least one value in the array must match
 * - Omitted field: unconstrained (matches any value)
 * - Empty array: matches nothing (entry is never available)
 * - undefined/empty object: always available
 *
 * @example macOS only
 * ```typescript
 * { os: ['darwin'] }
 * ```
 *
 * @example CLI binary on Linux only (issue #417)
 * ```typescript
 * { target: ['cli'], os: ['linux'] }
 * ```
 *
 * @example MCP-only — block CLI / agent / job invocations (issue #417)
 * ```typescript
 * { surface: ['mcp'] }
 * ```
 */
export interface EntryAvailability {
  /** OS constraint (issue #417: renamed from `platform`). */
  os?: string[];
  /** @deprecated Use `os` instead. Legacy alias preserved for back-compat. */
  platform?: string[];
  /** Runtime constraint: 'node', 'browser', 'edge', 'bun', 'deno' */
  runtime?: string[];
  /** Deployment constraint: 'distributed', 'serverless', 'standalone', 'browser' */
  deployment?: string[];
  /** Deploy-provider constraint (issue #417). */
  provider?: string[];
  /** Build-target constraint (issue #417). */
  target?: string[];
  /** Surface constraint (issue #417): 'mcp', 'cli', 'agent', 'job', 'http-trigger'. */
  surface?: Surface[];
  /** Environment constraint: 'production', 'development', 'test', etc. */
  env?: string[];
}

// ============================================
// Zod Schema
// ============================================

/**
 * Zod schema for validating EntryAvailability in metadata.
 */
export const entryAvailabilitySchema = z
  .object({
    os: z.array(z.string().min(1)).optional(),
    platform: z.array(z.string().min(1)).optional(),
    runtime: z.array(z.string().min(1)).optional(),
    deployment: z.array(z.string().min(1)).optional(),
    provider: z.array(z.string().min(1)).optional(),
    target: z.array(z.string().min(1)).optional(),
    surface: z.array(z.enum(['mcp', 'cli', 'http-trigger', 'job', 'agent'])).optional(),
    env: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ============================================
// Pure Matcher
// ============================================

/** Process-global axes that read directly off `RuntimeContext`. */
const PROCESS_AXES: Array<{ key: keyof EntryAvailability; ctxKey: keyof RuntimeContext }> = [
  // `os` and `platform` both compare against the same RuntimeContext value
  // — keeping `platform` as a deprecated alias lets pre-#417 metadata
  // continue to match without any code change.
  { key: 'os', ctxKey: 'os' },
  { key: 'platform', ctxKey: 'platform' },
  { key: 'runtime', ctxKey: 'runtime' },
  { key: 'deployment', ctxKey: 'deployment' },
  { key: 'provider', ctxKey: 'provider' },
  { key: 'target', ctxKey: 'target' },
  { key: 'env', ctxKey: 'env' },
];

/**
 * Check if an entry is available in the given runtime context.
 *
 * Surface is checked separately because it's a per-call axis, not a
 * process-global one. Pass it via `callCtx.surface` to enforce
 * `availableWhen.surface` at call time.
 *
 * @param availability - The constraint (undefined = always available)
 * @param ctx - The current runtime context
 * @param callCtx - Optional per-call context (surface, …)
 * @returns true if the entry should be available
 */
export function isEntryAvailable(
  availability: EntryAvailability | undefined,
  ctx: RuntimeContext,
  callCtx?: CallContext,
): boolean {
  if (!availability) return true;

  for (const { key, ctxKey } of PROCESS_AXES) {
    const allowed = availability[key] as string[] | undefined;
    if (allowed === undefined) continue;
    if (allowed.length === 0) return false;
    if (!allowed.includes(ctx[ctxKey])) return false;
  }

  if (availability.surface !== undefined) {
    if (availability.surface.length === 0) return false;
    // Only enforce surface when the caller actually tagged it. Listing /
    // registry-level callers that don't carry a surface skip this axis so
    // we don't accidentally exclude tools at boot.
    if (callCtx?.surface !== undefined && !availability.surface.includes(callCtx.surface)) {
      return false;
    }
  }

  return true;
}

/**
 * Structured variant of `isEntryAvailable` — returns the list of axes
 * that failed so flow-level call sites can build a `missingAxes`-shaped
 * error response (issue #417).
 */
export function checkEntryAvailability(
  availability: EntryAvailability | undefined,
  ctx: RuntimeContext,
  callCtx?: CallContext,
): { available: boolean; missingAxes: (keyof EntryAvailability)[] } {
  if (!availability) return { available: true, missingAxes: [] };

  const missing: (keyof EntryAvailability)[] = [];

  for (const { key, ctxKey } of PROCESS_AXES) {
    const allowed = availability[key] as string[] | undefined;
    if (allowed === undefined) continue;
    if (allowed.length === 0 || !allowed.includes(ctx[ctxKey])) {
      missing.push(key);
    }
  }

  if (availability.surface !== undefined) {
    if (availability.surface.length === 0) {
      missing.push('surface');
    } else if (callCtx?.surface !== undefined && !availability.surface.includes(callCtx.surface)) {
      missing.push('surface');
    }
  }

  return { available: missing.length === 0, missingAxes: missing };
}

// ============================================
// Detection
// ============================================

function detectRuntime(): string {
  if (typeof globalThis !== 'undefined' && 'Bun' in (globalThis as any)) return 'bun';

  if (typeof globalThis !== 'undefined' && 'Deno' in (globalThis as any)) return 'deno';
  if (isEdgeRuntime()) return 'edge';
  return 'node';
}

/**
 * Detect the deployment mode from build-injected env var or platform detection.
 *
 * Priority:
 * 1. FRONTMCP_DEPLOYMENT_MODE env var (set by build adapters)
 * 2. Platform-based detection (isServerless, isEdgeRuntime)
 * 3. Default: 'standalone'
 */
function detectDeployment(runtime: string): string {
  const explicit = process.env['FRONTMCP_DEPLOYMENT_MODE'];
  if (explicit === 'distributed') return 'distributed';
  if (explicit === 'serverless') return 'serverless';
  if (runtime === 'browser') return 'browser';
  if (isServerless()) return 'serverless';
  return 'standalone';
}

/**
 * Detect the current runtime context from the environment.
 */
export function detectRuntimeContext(): RuntimeContext {
  const runtime = detectRuntime();
  const os = process.platform;
  return {
    os,
    platform: os,
    runtime,
    deployment: detectDeployment(runtime),
    provider: detectProvider(),
    target: getBuildTarget(),
    env: process.env['NODE_ENV'] || 'development',
  };
}

// ============================================
// Singleton
// ============================================

let cached: RuntimeContext | undefined;

/**
 * Get the current runtime context (lazy singleton).
 * The context is detected on first call and cached for the process lifetime.
 */
export function getRuntimeContext(): RuntimeContext {
  if (!cached) {
    cached = detectRuntimeContext();
  }
  return cached;
}

/**
 * Reset the cached runtime context. For testing only.
 */
export function resetRuntimeContext(): void {
  cached = undefined;
}
