/**
 * Runtime context detection and entry availability matching (Browser version).
 *
 * Returns safe defaults for browser environments. The matcher and
 * `EntryAvailability` shape track the Node version (issue #417 added
 * `os`/`provider`/`target`/`surface`).
 */

import { z } from '@frontmcp/lazy-zod';

// ============================================
// Types (identical to Node version — issue #417)
// ============================================

export interface RuntimeContext {
  /** Issue #417: renamed from `platform`. */
  os: string;
  /** @deprecated Use `os`. */
  platform: string;
  runtime: string;
  deployment: string;
  /** Issue #417 — deploy provider. Always `'bare'` in browser. */
  provider: string;
  /** Issue #417 — build target. Always `'browser'` in browser. */
  target: string;
  env: string;
}

export type Surface = 'mcp' | 'cli' | 'http-trigger' | 'job' | 'agent';

export interface CallContext {
  surface?: Surface;
}

export interface EntryAvailability {
  /** Issue #417: renamed from `platform`. */
  os?: string[];
  /** @deprecated Use `os`. */
  platform?: string[];
  runtime?: string[];
  deployment?: string[];
  provider?: string[];
  target?: string[];
  surface?: Surface[];
  env?: string[];
}

// ============================================
// Zod Schema (identical to Node version)
// ============================================

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
// Pure Matcher (identical to Node version)
// ============================================

const PROCESS_AXES: Array<{ key: keyof EntryAvailability; ctxKey: keyof RuntimeContext }> = [
  { key: 'os', ctxKey: 'os' },
  { key: 'platform', ctxKey: 'platform' },
  { key: 'runtime', ctxKey: 'runtime' },
  { key: 'deployment', ctxKey: 'deployment' },
  { key: 'provider', ctxKey: 'provider' },
  { key: 'target', ctxKey: 'target' },
  { key: 'env', ctxKey: 'env' },
];

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
    if (callCtx?.surface !== undefined && !availability.surface.includes(callCtx.surface)) return false;
  }
  return true;
}

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
    if (allowed.length === 0 || !allowed.includes(ctx[ctxKey])) missing.push(key);
  }
  if (availability.surface !== undefined) {
    if (availability.surface.length === 0) missing.push('surface');
    else if (callCtx?.surface !== undefined && !availability.surface.includes(callCtx.surface)) missing.push('surface');
  }
  return { available: missing.length === 0, missingAxes: missing };
}

// ============================================
// Browser Detection (fixed values)
// ============================================

export function detectRuntimeContext(): RuntimeContext {
  return {
    os: 'browser',
    platform: 'browser',
    runtime: 'browser',
    deployment: 'standalone',
    provider: 'bare',
    target: 'browser',
    env: 'production',
  };
}

// ============================================
// Singleton
// ============================================

const browserContext: RuntimeContext = detectRuntimeContext();

export function getRuntimeContext(): RuntimeContext {
  return browserContext;
}

export function resetRuntimeContext(): void {
  // No-op in browser
}
