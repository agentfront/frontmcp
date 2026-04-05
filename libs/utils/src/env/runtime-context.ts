/**
 * Runtime context detection and entry availability matching (Node.js version).
 *
 * Provides:
 * - `RuntimeContext` — snapshot of the current platform, runtime, deployment, and env
 * - `EntryAvailability` — declarative constraint for when an entry is available
 * - `getRuntimeContext()` — lazy singleton returning the detected context
 * - `isEntryAvailable()` — pure matcher: does the constraint match the context?
 */

import { z } from 'zod';
import { isEdgeRuntime, isServerless } from '#env';

// ============================================
// Types
// ============================================

/**
 * Snapshot of the current runtime environment.
 * Detected once and cached for the lifetime of the process.
 */
export interface RuntimeContext {
  /** OS platform: 'darwin', 'linux', 'win32', 'freebsd', etc. */
  platform: string;
  /** JavaScript runtime: 'node', 'bun', 'deno', 'edge', 'browser' */
  runtime: string;
  /** Deployment mode: 'serverless' or 'standalone' */
  deployment: string;
  /** NODE_ENV value: 'production', 'development', 'test', etc. */
  env: string;
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
 * { platform: ['darwin'] }
 * ```
 *
 * @example Node.js or Bun, production only
 * ```typescript
 * { runtime: ['node', 'bun'], env: ['production'] }
 * ```
 */
export interface EntryAvailability {
  /** OS platform constraint: 'darwin', 'linux', 'win32', etc. */
  platform?: string[];
  /** Runtime constraint: 'node', 'browser', 'edge', 'bun', 'deno' */
  runtime?: string[];
  /** Deployment constraint: 'serverless', 'standalone' */
  deployment?: string[];
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
    platform: z.array(z.string().min(1)).optional(),
    runtime: z.array(z.string().min(1)).optional(),
    deployment: z.array(z.string().min(1)).optional(),
    env: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ============================================
// Pure Matcher
// ============================================

/**
 * Check if an entry is available in the given runtime context.
 *
 * @param availability - The constraint (undefined = always available)
 * @param ctx - The current runtime context
 * @returns true if the entry should be available
 */
export function isEntryAvailable(availability: EntryAvailability | undefined, ctx: RuntimeContext): boolean {
  if (!availability) return true;

  const fields: (keyof EntryAvailability)[] = ['platform', 'runtime', 'deployment', 'env'];
  for (const field of fields) {
    const allowed = availability[field];
    if (allowed === undefined) continue;
    if (allowed.length === 0) return false;
    if (!allowed.includes(ctx[field])) return false;
  }

  return true;
}

// ============================================
// Detection
// ============================================

function detectRuntime(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof globalThis !== 'undefined' && 'Bun' in (globalThis as any)) return 'bun';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof globalThis !== 'undefined' && 'Deno' in (globalThis as any)) return 'deno';
  if (isEdgeRuntime()) return 'edge';
  return 'node';
}

/**
 * Detect the current runtime context from the environment.
 */
export function detectRuntimeContext(): RuntimeContext {
  return {
    platform: process.platform,
    runtime: detectRuntime(),
    deployment: isServerless() ? 'serverless' : 'standalone',
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
