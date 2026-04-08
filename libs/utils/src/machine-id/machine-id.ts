/**
 * Machine ID Utility
 *
 * Single source of truth for the machine ID used across session management,
 * transport session affinity, and HA features.
 *
 * Resolution depends on deployment mode (set by `frontmcp build -t {target}`):
 *
 * **Distributed** (`FRONTMCP_DEPLOYMENT_MODE=distributed`):
 *   1. MACHINE_ID env var (explicit override)
 *   2. HOSTNAME env var (K8s pod name — auto-set by Kubernetes)
 *   3. os.hostname() (non-K8s distributed)
 *
 * **Serverless** (`FRONTMCP_DEPLOYMENT_MODE=serverless`):
 *   1. MACHINE_ID env var (explicit override)
 *   2. Random UUID (ephemeral — no file persistence)
 *
 * **Standalone** (default — `node` or `cli` build targets):
 *   1. MACHINE_ID env var (explicit override)
 *   2. File persistence at `.frontmcp/machine-id` (dev mode)
 *   3. Random UUID (production)
 */

import { randomUUID } from '../crypto';
import { isBrowser, isNode } from '../crypto/runtime';

// Use process.env directly for IIFE (runs at module load — cannot rely on lazy #env alias)
function getEnvDirect(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

function isProductionDirect(): boolean {
  return getEnvDirect('NODE_ENV') === 'production';
}

const DEFAULT_MACHINE_ID_PATH = '.frontmcp/machine-id';

function isDevPersistenceEnabled(): boolean {
  if (isBrowser()) return false;
  return !isProductionDirect();
}

function resolveMachineIdPath(): string {
  if (isBrowser()) return DEFAULT_MACHINE_ID_PATH;
  const path = require('path') as typeof import('path');
  const machineIdPath = getEnvDirect('MACHINE_ID_PATH') ?? DEFAULT_MACHINE_ID_PATH;
  const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
  return path.isAbsolute(machineIdPath) ? machineIdPath : path.resolve(cwd, machineIdPath);
}

function loadMachineIdSync(): string | null {
  if (!isDevPersistenceEnabled()) return null;

  const machineIdPath = resolveMachineIdPath();
  try {
    const fs = require('fs') as typeof import('fs');
    const content = fs.readFileSync(machineIdPath, 'utf8').trim();
    if (/^[0-9a-f-]{32,36}$/i.test(content)) return content;
    console.warn(`[MachineId] Invalid format at ${machineIdPath}, will regenerate`);
    return null;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[MachineId] Failed to load from ${machineIdPath}: ${(error as Error).message}`);
    }
    return null;
  }
}

function saveMachineIdAsync(machineId: string): void {
  if (!isDevPersistenceEnabled()) return;

  const machineIdPath = resolveMachineIdPath();
  const path = require('path') as typeof import('path');
  const dir = path.dirname(machineIdPath);

  (async () => {
    try {
      const fsp = require('fs').promises as typeof import('fs/promises');
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      await fsp.writeFile(machineIdPath, machineId, { mode: 0o600 });
    } catch (error) {
      console.warn(`[MachineId] Failed to save to ${machineIdPath}: ${(error as Error).message}`);
    }
  })();
}

/**
 * Resolve machine ID based on deployment mode.
 */
const machineId = (() => {
  // 0. Explicit override always wins
  const envMachineId = getEnvDirect('MACHINE_ID');
  if (envMachineId) return envMachineId;

  const deploymentMode = getEnvDirect('FRONTMCP_DEPLOYMENT_MODE');

  // 1. Distributed: use K8s pod name (HOSTNAME) or os.hostname()
  if (deploymentMode === 'distributed') {
    const hostname = getEnvDirect('HOSTNAME');
    if (hostname) return hostname;
    if (isNode()) {
      const os = require('os') as typeof import('os');
      return os.hostname();
    }
  }

  // 2. Serverless/Edge: ephemeral, no persistence
  if (deploymentMode === 'serverless') {
    return randomUUID();
  }

  // 3. Standalone: file persistence in dev, random in prod (default behavior)
  const loadedId = loadMachineIdSync();
  if (loadedId) return loadedId;
  const newId = randomUUID();
  saveMachineIdAsync(newId);
  return newId;
})();

/** Process-wide override set by `setMachineIdOverride()` for session continuity */
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
 */
export function setMachineIdOverride(id: string | undefined): void {
  machineIdOverride = id;
}
