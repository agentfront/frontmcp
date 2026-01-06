/**
 * Secret persistence utilities for storing encryption secrets.
 *
 * Follows the same pattern as OAuth JWK dev-key-persistence for consistency.
 * Stores a random secret to a JSON file for use when no environment variable is set.
 *
 * This enables development environments to have consistent encryption keys
 * without requiring manual configuration.
 *
 * @module @frontmcp/utils/secret-persistence
 */

import * as path from 'path';
import { readFile, writeFile, mkdir, rename, unlink } from '../../fs';
import { randomBytes, base64urlEncode } from '../';
import type { SecretData, SecretPersistenceOptions } from './types';
import { validateSecretData } from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default number of bytes for secret generation (256 bits) */
const DEFAULT_SECRET_BYTES = 32;

/** Default directory for secret files */
const DEFAULT_SECRET_DIR = '.frontmcp';

// ─────────────────────────────────────────────────────────────────────────────
// Environment Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if secret persistence is enabled based on environment and options.
 *
 * By default, persistence is:
 * - Enabled in development (NODE_ENV !== 'production')
 * - Disabled in production unless forceEnable is true
 *
 * @param options - Persistence options
 * @returns true if persistence is enabled
 */
export function isSecretPersistenceEnabled(options?: SecretPersistenceOptions): boolean {
  const isProduction = process.env['NODE_ENV'] === 'production';

  // In production, only enable if explicitly forced
  if (isProduction) {
    return options?.forceEnable === true;
  }

  // In development, enabled by default
  return true;
}

/**
 * Resolve the secret file path.
 *
 * @param options - Persistence options
 * @returns Absolute path to secret file
 */
export function resolveSecretPath(options?: SecretPersistenceOptions): string {
  if (options?.secretPath) {
    // If absolute path, use as-is
    if (path.isAbsolute(options.secretPath)) {
      return options.secretPath;
    }
    // Relative paths are resolved from current working directory
    return path.resolve(process.cwd(), options.secretPath);
  }

  // Default path using name
  const name = options?.name ?? 'default';
  const defaultPath = `${DEFAULT_SECRET_DIR}/${name}-secret.json`;
  return path.resolve(process.cwd(), defaultPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

// No-op function for disabled logging
const noop = () => {
  /* intentionally empty */
};

function getLogger(options?: SecretPersistenceOptions) {
  if (options?.enableLogging === false) {
    return { warn: noop, error: noop };
  }
  return options?.logger ?? { warn: console.warn, error: console.error };
}

function getLogPrefix(options?: SecretPersistenceOptions): string {
  const name = options?.name ?? 'Secret';
  return `[${name}Persistence]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load persisted secret from file.
 *
 * @param options - Persistence options
 * @returns The loaded secret data or null if not found/invalid
 */
export async function loadSecret(options?: SecretPersistenceOptions): Promise<SecretData | null> {
  if (!isSecretPersistenceEnabled(options)) {
    return null;
  }

  const secretPath = resolveSecretPath(options);
  const logger = getLogger(options);
  const prefix = getLogPrefix(options);

  try {
    const content = await readFile(secretPath);
    const data = JSON.parse(content);

    // Validate structure
    const validation = validateSecretData(data);
    if (!validation.valid) {
      logger.warn(`${prefix} Invalid secret file format at ${secretPath}: ${validation.error}, will regenerate`);
      return null;
    }

    return data as SecretData;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - normal for first run
      return null;
    }

    logger.warn(`${prefix} Failed to load secret from ${secretPath}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Save secret to file.
 *
 * Uses atomic write (temp file + rename) to prevent corruption.
 * Sets file permissions to 0o600 (owner read/write only) for security.
 *
 * @param secretData - Secret data to persist
 * @param options - Persistence options
 * @returns true if save succeeded, false otherwise
 */
export async function saveSecret(secretData: SecretData, options?: SecretPersistenceOptions): Promise<boolean> {
  if (!isSecretPersistenceEnabled(options)) {
    return true; // Not enabled is not a failure
  }

  const secretPath = resolveSecretPath(options);
  const dir = path.dirname(secretPath);
  const tempPath = `${secretPath}.tmp.${Date.now()}.${base64urlEncode(randomBytes(8))}`;
  const logger = getLogger(options);
  const prefix = getLogPrefix(options);

  try {
    // Ensure directory exists with restricted permissions
    await mkdir(dir, { recursive: true, mode: 0o700 });

    // Write to temp file first (atomic write pattern)
    const content = JSON.stringify(secretData, null, 2);
    await writeFile(tempPath, content, { mode: 0o600 });

    // Atomic rename to target path
    await rename(tempPath, secretPath);

    return true;
  } catch (error: unknown) {
    logger.error(`${prefix} Failed to save secret to ${secretPath}: ${(error as Error).message}`);
    // Clean up temp file if it exists
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Delete persisted secret.
 *
 * @param options - Persistence options
 * @returns true if deleted or didn't exist, false on error
 */
export async function deleteSecret(options?: SecretPersistenceOptions): Promise<boolean> {
  const secretPath = resolveSecretPath(options);
  const logger = getLogger(options);
  const prefix = getLogPrefix(options);

  try {
    await unlink(secretPath);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - that's fine
      return true;
    }
    logger.warn(`${prefix} Failed to delete secret at ${secretPath}: ${(error as Error).message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new random secret.
 *
 * @param bytes - Number of random bytes (default 32 = 256 bits)
 * @returns Base64url-encoded random string
 */
export function generateSecret(bytes: number = DEFAULT_SECRET_BYTES): string {
  return base64urlEncode(randomBytes(bytes));
}

/**
 * Create a new secret data object with current timestamp.
 *
 * @param options - Options including secret bytes
 * @returns New SecretData object
 */
export function createSecretData(options?: SecretPersistenceOptions): SecretData {
  const secretBytes = options?.secretBytes ?? DEFAULT_SECRET_BYTES;
  return {
    secret: generateSecret(secretBytes),
    createdAt: Date.now(),
    version: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// High-Level API
// ─────────────────────────────────────────────────────────────────────────────

/** Cache for secrets by name to avoid repeated file I/O */
const secretCache = new Map<string, string>();

/** Promise guards to prevent concurrent generation per name */
const generationPromises = new Map<string, Promise<string>>();

/**
 * Get or create a persisted secret.
 *
 * This is the main entry point for getting a secret.
 * It will:
 * 1. Return cached secret if available (for this name)
 * 2. Load from file if exists
 * 3. Generate new secret and persist it
 *
 * Thread-safe: concurrent calls will share the same generation promise.
 *
 * @param options - Persistence options
 * @returns The secret string
 */
export async function getOrCreateSecret(options?: SecretPersistenceOptions): Promise<string> {
  const cacheKey = resolveSecretPath(options);

  // Return cached secret if available
  const cached = secretCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Use promise guard to prevent concurrent generation
  const existing = generationPromises.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      // Try to load existing secret
      const loaded = await loadSecret(options);
      if (loaded) {
        secretCache.set(cacheKey, loaded.secret);
        return loaded.secret;
      }

      // Generate new secret
      const secretData = createSecretData(options);

      // Persist if enabled
      if (isSecretPersistenceEnabled(options)) {
        await saveSecret(secretData, options);
      }

      secretCache.set(cacheKey, secretData.secret);
      return secretData.secret;
    } finally {
      generationPromises.delete(cacheKey);
    }
  })();

  generationPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Clear the cached secret (for testing).
 *
 * @param options - Options to identify which secret to clear (by path)
 */
export function clearCachedSecret(options?: SecretPersistenceOptions): void {
  if (options) {
    const cacheKey = resolveSecretPath(options);
    secretCache.delete(cacheKey);
  } else {
    secretCache.clear();
  }
}

/**
 * Check if a secret is cached.
 *
 * @param options - Options to identify which secret to check
 * @returns true if cached
 */
export function isSecretCached(options?: SecretPersistenceOptions): boolean {
  const cacheKey = resolveSecretPath(options);
  return secretCache.has(cacheKey);
}
