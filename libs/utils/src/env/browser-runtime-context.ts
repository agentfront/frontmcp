/**
 * Runtime context detection and entry availability matching (Browser version).
 *
 * Returns safe defaults for browser environments.
 * The isEntryAvailable matcher works identically to the Node version.
 */

import { z } from 'zod';

// ============================================
// Types (identical to Node version)
// ============================================

export interface RuntimeContext {
  platform: string;
  runtime: string;
  deployment: string;
  env: string;
}

export interface EntryAvailability {
  platform?: string[];
  runtime?: string[];
  deployment?: string[];
  env?: string[];
}

// ============================================
// Zod Schema (identical to Node version)
// ============================================

export const entryAvailabilitySchema = z
  .object({
    platform: z.array(z.string().min(1)).optional(),
    runtime: z.array(z.string().min(1)).optional(),
    deployment: z.array(z.string().min(1)).optional(),
    env: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ============================================
// Pure Matcher (identical to Node version)
// ============================================

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
// Browser Detection (fixed values)
// ============================================

export function detectRuntimeContext(): RuntimeContext {
  return {
    platform: 'browser',
    runtime: 'browser',
    deployment: 'standalone',
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
