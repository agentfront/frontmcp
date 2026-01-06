/**
 * Secret persistence for RememberPlugin encryption.
 *
 * Follows the same pattern as OAuth JWK dev-key-persistence for consistency.
 * Stores a random secret to `.frontmcp/remember-secret.json` for use when
 * no environment variable is set.
 *
 * This enables distributed deployments to share the same encryption secret
 * without requiring manual configuration (for development/testing).
 */
import * as path from 'path';
import { z } from 'zod';
import { randomBytes, base64urlEncode, readFile, mkdir, writeFile, rename, unlink } from '@frontmcp/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Data structure for persisted remember secret.
 */
export interface RememberSecretData {
  /** Random secret, base64url encoded (32 bytes = 256 bits) */
  secret: string;
  /** Creation timestamp (ms) */
  createdAt: number;
  /** Version for future migrations */
  version: 1;
}

/**
 * Options for secret persistence.
 */
export interface SecretPersistenceOptions {
  /**
   * Path to store the secret.
   * @default '.frontmcp/remember-secret.json'
   */
  secretPath?: string;
  /**
   * Enable persistence in production (NOT RECOMMENDED for multi-server).
   * In production, use REMEMBER_SECRET env var instead.
   * @default false
   */
  forceEnable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default file path for storing the encryption secret (not the secret itself) */
// snyk:ignore CWE-547 - This is a file path, not a cryptographic secret
const DEFAULT_SECRET_FILE_PATH = '.frontmcp/remember-secret.json';
const SECRET_BYTES = 32; // 256 bits

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zod schema for RememberSecretData.
 */
const rememberSecretDataSchema = z.object({
  secret: z.string().min(32), // base64url of 32 bytes is ~43 chars
  createdAt: z.number().positive().int(),
  version: z.literal(1),
});

/**
 * Validate secret data structure.
 */
function validateSecretData(data: unknown): { valid: boolean; error?: string } {
  const result = rememberSecretDataSchema.safeParse(data);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message ?? 'Invalid secret structure' };
  }

  const parsed = result.data;

  // Verify createdAt is not in the future
  const now = Date.now();
  if (parsed.createdAt > now + 60000) {
    // Allow 1 minute drift
    return { valid: false, error: 'createdAt is in the future' };
  }

  // Verify not too old (100 years - same as dev-key-persistence)
  const hundredYearsMs = 100 * 365 * 24 * 60 * 60 * 1000;
  if (parsed.createdAt < now - hundredYearsMs) {
    return { valid: false, error: 'createdAt is too old' };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if secret persistence is enabled based on environment and options.
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
 */
export function resolveSecretPath(options?: SecretPersistenceOptions): string {
  const secretPath = options?.secretPath ?? DEFAULT_SECRET_FILE_PATH;

  // If absolute path, use as-is
  if (path.isAbsolute(secretPath)) {
    return secretPath;
  }

  // Relative paths are resolved from current working directory
  return path.resolve(process.cwd(), secretPath);
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
export async function loadRememberSecret(options?: SecretPersistenceOptions): Promise<RememberSecretData | null> {
  if (!isSecretPersistenceEnabled(options)) {
    return null;
  }

  const secretPath = resolveSecretPath(options);

  try {
    const content = await readFile(secretPath, 'utf8');
    const data = JSON.parse(content);

    // Validate structure using Zod schema
    const validation = validateSecretData(data);
    if (!validation.valid) {
      console.warn(
        `[RememberSecretPersistence] Invalid secret file format at ${secretPath}: ${validation.error}, will regenerate`,
      );
      return null;
    }

    return data as RememberSecretData;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - normal for first run
      return null;
    }

    console.warn(`[RememberSecretPersistence] Failed to load secret from ${secretPath}: ${(error as Error).message}`);
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
export async function saveRememberSecret(
  secretData: RememberSecretData,
  options?: SecretPersistenceOptions,
): Promise<boolean> {
  if (!isSecretPersistenceEnabled(options)) {
    return true; // Not enabled is not a failure
  }

  const secretPath = resolveSecretPath(options);
  const dir = path.dirname(secretPath);
  const tempPath = `${secretPath}.tmp.${Date.now()}.${base64urlEncode(randomBytes(8))}`;

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
    console.error(`[RememberSecretPersistence] Failed to save secret to ${secretPath}: ${(error as Error).message}`);
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
 */
export async function deleteRememberSecret(options?: SecretPersistenceOptions): Promise<void> {
  const secretPath = resolveSecretPath(options);

  try {
    await unlink(secretPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[RememberSecretPersistence] Failed to delete secret at ${secretPath}: ${(error as Error).message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// High-Level API
// ─────────────────────────────────────────────────────────────────────────────

/** Cached secret to avoid repeated file I/O */
let cachedSecret: string | null = null;

/** Promise guard to prevent concurrent generation */
let secretGenerationPromise: Promise<string> | null = null;

/**
 * Generate a new random secret.
 */
function generateSecret(): string {
  return base64urlEncode(randomBytes(SECRET_BYTES));
}

/**
 * Get or create a persisted secret.
 *
 * This is the main entry point for getting the base secret.
 * It will:
 * 1. Return cached secret if available
 * 2. Load from file if exists
 * 3. Generate new secret and persist it
 *
 * @param options - Persistence options
 * @returns The secret string
 */
export async function getOrCreatePersistedSecret(options?: SecretPersistenceOptions): Promise<string> {
  // Return cached secret if available
  if (cachedSecret) {
    return cachedSecret;
  }

  // Use promise guard to prevent concurrent generation
  if (secretGenerationPromise) {
    return secretGenerationPromise;
  }

  secretGenerationPromise = (async () => {
    try {
      // Try to load existing secret
      const loaded = await loadRememberSecret(options);
      if (loaded) {
        cachedSecret = loaded.secret;
        return cachedSecret;
      }

      // Generate new secret
      const newSecret = generateSecret();
      const secretData: RememberSecretData = {
        secret: newSecret,
        createdAt: Date.now(),
        version: 1,
      };

      // Persist if enabled
      if (isSecretPersistenceEnabled(options)) {
        await saveRememberSecret(secretData, options);
      }

      cachedSecret = newSecret;
      return cachedSecret;
    } finally {
      secretGenerationPromise = null;
    }
  })();

  return secretGenerationPromise;
}

/**
 * Clear the cached secret (for testing).
 */
export function clearCachedSecret(): void {
  cachedSecret = null;
}
