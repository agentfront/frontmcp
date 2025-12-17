// auth/machine-id.ts
// Single source of truth for the machine ID used across session management
import { randomUUID } from 'crypto';

/**
 * Single-process machine ID generated at server launch.
 * Used for:
 * - Session encryption key derivation
 * - Session validation (nodeId matching)
 *
 * All session-related modules should import getMachineId from this module
 * to ensure consistency across the application.
 */
const MACHINE_ID = (() => {
  // Prefer an injected env (stable across restarts) if you have one; else random per launch
  return process.env['MACHINE_ID'] || randomUUID();
})();

/**
 * Get the current machine ID.
 * This value is stable for the lifetime of the process.
 */
export function getMachineId(): string {
  return MACHINE_ID;
}
