/**
 * Browser Machine ID
 *
 * Generates and persists a machine ID in the browser using localStorage.
 * Falls back to in-memory storage if localStorage is unavailable (e.g., incognito with quota).
 *
 * Unlike the Node.js implementation, this does not use file system persistence
 * or environment variables.
 */

import { randomUUID } from '@frontmcp/utils';

const STORAGE_KEY = 'frontmcp:machine-id';

/** In-memory fallback when localStorage is unavailable */
let inMemoryId: string | undefined;

/**
 * Try to read machine ID from localStorage.
 */
function loadFromStorage(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && /^[0-9a-f-]{32,36}$/i.test(stored)) {
        return stored;
      }
    }
  } catch {
    // localStorage may throw in some environments (e.g., Safari private browsing)
  }
  return null;
}

/**
 * Try to save machine ID to localStorage.
 */
function saveToStorage(id: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // Silently fail if localStorage is not available
  }
}

/**
 * Get or create the browser machine ID.
 * - First checks localStorage for a persisted ID
 * - Falls back to generating a new UUID
 * - Persists to localStorage if possible
 */
function initMachineId(): string {
  const stored = loadFromStorage();
  if (stored) return stored;

  const id = randomUUID();
  saveToStorage(id);
  inMemoryId = id;
  return id;
}

const machineId = initMachineId();

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
 * Set a machine ID override.
 * Pass `undefined` to clear the override and revert to the computed value.
 */
export function setMachineIdOverride(id: string | undefined): void {
  machineIdOverride = id;
}
