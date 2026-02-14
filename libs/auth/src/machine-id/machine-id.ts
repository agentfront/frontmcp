// machine-id/machine-id.ts
/**
 * Machine ID Utility
 *
 * Single source of truth for the machine ID used across session management.
 *
 * Configuration Priority:
 * 1. MACHINE_ID environment variable (highest priority, recommended for production)
 * 2. File persistence in dev mode (.frontmcp/machine-id)
 * 3. Random UUID (ephemeral, invalidates sessions on restart)
 *
 * For distributed deployments with Redis session storage, set MACHINE_ID
 * to the same value across all instances to allow session portability,
 * or use unique values per instance to enforce session affinity.
 */

import * as path from 'path';
import { randomUUID, mkdir, writeFile, readFileSync } from '@frontmcp/utils';

const DEFAULT_MACHINE_ID_PATH = '.frontmcp/machine-id';

/**
 * Check if dev persistence is enabled (non-production mode)
 */
function isDevPersistenceEnabled(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

/**
 * Resolve the machine ID file path
 */
function resolveMachineIdPath(): string {
  const machineIdPath = process.env['MACHINE_ID_PATH'] ?? DEFAULT_MACHINE_ID_PATH;
  return path.isAbsolute(machineIdPath) ? machineIdPath : path.resolve(process.cwd(), machineIdPath);
}

/**
 * Load persisted machine ID from file (sync)
 */
function loadMachineIdSync(): string | null {
  if (!isDevPersistenceEnabled()) {
    return null;
  }

  const machineIdPath = resolveMachineIdPath();

  try {
    // Use @frontmcp/utils readFileSync with lazy-load pattern
    const content = readFileSync(machineIdPath, 'utf8').trim();

    // Validate UUID format (loose check)
    if (/^[0-9a-f-]{32,36}$/i.test(content)) {
      return content;
    }

    console.warn(`[MachineId] Invalid format at ${machineIdPath}, will regenerate`);
    return null;
  } catch (error: unknown) {
    // ENOENT is expected on first run
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[MachineId] Failed to load from ${machineIdPath}: ${(error as Error).message}`);
    }
    return null;
  }
}

/**
 * Save machine ID to file (fire-and-forget during init)
 */
function saveMachineIdAsync(machineId: string): void {
  if (!isDevPersistenceEnabled()) {
    return;
  }

  const machineIdPath = resolveMachineIdPath();
  const dir = path.dirname(machineIdPath);

  // Fire-and-forget - we don't want to block startup
  (async () => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(machineIdPath, machineId, { mode: 0o600 });
    } catch (error) {
      console.warn(`[MachineId] Failed to save to ${machineIdPath}: ${(error as Error).message}`);
    }
  })();
}

/**
 * Single-process machine ID.
 *
 * Used for:
 * - Session encryption key derivation
 * - Session validation (nodeId matching)
 *
 * IMPORTANT:
 * - In development: Persisted to `.frontmcp/machine-id` for session stability across restarts
 * - In production: Set MACHINE_ID env var for stability, or allow ephemeral generation
 * - For distributed systems: Use same MACHINE_ID for portability, or unique per-node for affinity
 */
const machineId = (() => {
  // 1. Check env var (highest priority - supports Redis, K8s, etc.)
  const envMachineId = process.env['MACHINE_ID'];
  if (envMachineId) {
    return envMachineId;
  }

  // 2. Try to load from file in dev mode
  const loadedId = loadMachineIdSync();
  if (loadedId) {
    return loadedId;
  }

  // 3. Generate new ID
  const newId = randomUUID();

  // 4. Save to file in dev mode (fire-and-forget)
  saveMachineIdAsync(newId);

  return newId;
})();

/** Process-wide override set by `create()` for session continuity */
let machineIdOverride: string | undefined;

/**
 * Get the current machine ID.
 * Returns the override (if set via `setMachineIdOverride`) or the computed value.
 */
export function getMachineId(): string {
  return machineIdOverride ?? machineId;
}

/**
 * Set a process-wide machine ID override.
 * Pass `undefined` to clear the override and revert to the computed value.
 *
 * This is used by `create()` to inject a stable machine ID for session continuity,
 * especially when using Redis-backed sessions across process restarts.
 */
export function setMachineIdOverride(id: string | undefined): void {
  machineIdOverride = id;
}
