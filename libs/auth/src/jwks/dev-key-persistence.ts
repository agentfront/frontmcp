// auth/jwks/dev-key-persistence.ts
/**
 * @deprecated This module is deprecated. Use `createKeyPersistence` from `@frontmcp/utils` instead.
 *
 * This module provides legacy dev key persistence functions for backwards compatibility.
 * It will be removed in a future major version.
 *
 * Migration example:
 * ```typescript
 * // Before (deprecated)
 * import { loadDevKey, saveDevKey } from '@frontmcp/auth';
 * const key = await loadDevKey();
 * await saveDevKey(keyData);
 *
 * // After (recommended)
 * import { createKeyPersistence } from '@frontmcp/utils';
 * const keys = await createKeyPersistence();
 * const key = await keys.getAsymmetric('my-key-id');
 * await keys.set(asymmetricKeyData);
 * ```
 */
import * as path from 'path';
import * as crypto from 'crypto';
import { JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { readFile, mkdir, writeFile, rename, unlink } from '@frontmcp/utils';

/**
 * Data structure for persisted development keys
 * @deprecated Use `AsymmetricKeyData` from `@frontmcp/utils` instead.
 */
export interface DevKeyData {
  /** Key ID (kid) */
  kid: string;
  /** Private key in JWK format (portable) */
  privateKey: JsonWebKey;
  /** Public JWKS for verification */
  publicJwk: JSONWebKeySet;
  /** Key creation timestamp (ms) */
  createdAt: number;
  /** Algorithm used */
  alg: 'RS256' | 'ES256';
}

/**
 * Options for dev key persistence
 */
export interface DevKeyPersistenceOptions {
  /**
   * Path to store dev keys
   * @default '.frontmcp/dev-keys.json'
   */
  keyPath?: string;
  /**
   * Enable persistence in production (NOT RECOMMENDED)
   * @default false
   */
  forceEnable?: boolean;
}

const DEFAULT_KEY_PATH = '.frontmcp/dev-keys.json';

/**
 * Zod schema for RSA JWK private key
 */
const rsaPrivateKeySchema = z
  .object({
    kty: z.literal('RSA'),
    n: z.string().min(1),
    e: z.string().min(1),
    d: z.string().min(1),
    p: z.string().optional(),
    q: z.string().optional(),
    dp: z.string().optional(),
    dq: z.string().optional(),
    qi: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for EC JWK private key
 */
const ecPrivateKeySchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.string().min(1),
    x: z.string().min(1),
    y: z.string().min(1),
    d: z.string().min(1),
  })
  .passthrough();

/**
 * Zod schema for public JWK (used in JWKS)
 */
const publicJwkSchema = z
  .object({
    kty: z.enum(['RSA', 'EC']),
    kid: z.string().min(1),
    alg: z.enum(['RS256', 'ES256']),
    use: z.literal('sig'),
  })
  .passthrough();

/**
 * Zod schema for JWKS
 */
const jwksSchema = z.object({
  keys: z.array(publicJwkSchema).min(1),
});

/**
 * Zod schema for DevKeyData
 */
const devKeyDataSchema = z.object({
  kid: z.string().min(1),
  privateKey: z.union([rsaPrivateKeySchema, ecPrivateKeySchema]),
  publicJwk: jwksSchema,
  createdAt: z.number().positive().int(),
  alg: z.enum(['RS256', 'ES256']),
});

/**
 * Validate JWK structure based on algorithm
 */
function validateJwkStructure(data: unknown): { valid: boolean; error?: string } {
  const result = devKeyDataSchema.safeParse(data);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message ?? 'Invalid JWK structure' };
  }

  const parsed = result.data;

  // Verify algorithm matches key type
  if (parsed.alg === 'RS256' && parsed.privateKey.kty !== 'RSA') {
    return { valid: false, error: 'Algorithm RS256 requires RSA key type' };
  }
  if (parsed.alg === 'ES256' && parsed.privateKey.kty !== 'EC') {
    return { valid: false, error: 'Algorithm ES256 requires EC key type' };
  }

  // Verify public key matches private key algorithm
  const publicKey = parsed.publicJwk.keys[0];
  if (publicKey.kty !== parsed.privateKey.kty) {
    return { valid: false, error: 'Public and private key types do not match' };
  }

  // Verify kid consistency between top-level and publicJwk
  if (publicKey.kid !== parsed.kid) {
    return { valid: false, error: 'kid mismatch between top-level and publicJwk' };
  }

  // Verify createdAt is not in the future and not too old (100 years)
  const now = Date.now();
  const hundredYearsMs = 100 * 365 * 24 * 60 * 60 * 1000;
  if (parsed.createdAt > now) {
    return { valid: false, error: 'createdAt is in the future' };
  }
  if (parsed.createdAt < now - hundredYearsMs) {
    return { valid: false, error: 'createdAt is too old' };
  }

  return { valid: true };
}

/**
 * Check if dev key persistence is enabled based on environment and options
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` instead.
 */
export function isDevKeyPersistenceEnabled(options?: DevKeyPersistenceOptions): boolean {
  const isProduction = process.env['NODE_ENV'] === 'production';

  // In production, only enable if explicitly forced
  if (isProduction) {
    return options?.forceEnable === true;
  }

  // In development, enabled by default
  return true;
}

/**
 * Resolve the key file path
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` instead.
 */
export function resolveKeyPath(options?: DevKeyPersistenceOptions): string {
  const keyPath = options?.keyPath ?? DEFAULT_KEY_PATH;

  // If absolute path, use as-is
  if (path.isAbsolute(keyPath)) {
    return keyPath;
  }

  // Relative paths are resolved from current working directory
  return path.resolve(process.cwd(), keyPath);
}

/**
 * Load persisted dev key from file
 *
 * @param options - Persistence options
 * @returns The loaded key data or null if not found/invalid
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` and call `getAsymmetric(kid)` instead.
 */
export async function loadDevKey(options?: DevKeyPersistenceOptions): Promise<DevKeyData | null> {
  if (!isDevKeyPersistenceEnabled(options)) {
    return null;
  }

  const keyPath = resolveKeyPath(options);

  try {
    const content = await readFile(keyPath, 'utf8');
    const data = JSON.parse(content);

    // Validate JWK structure using Zod schema
    const validation = validateJwkStructure(data);
    if (!validation.valid) {
      console.warn(`[DevKeyPersistence] Invalid key file format at ${keyPath}: ${validation.error}, will regenerate`);
      return null;
    }

    console.log(`[DevKeyPersistence] Loaded key (kid=${data.kid}) from ${keyPath}`);
    return data as DevKeyData;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - normal for first run
      return null;
    }

    console.warn(`[DevKeyPersistence] Failed to load key from ${keyPath}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Save dev key to file
 *
 * Uses atomic write (temp file + rename) to prevent corruption.
 * Sets file permissions to 0o600 (owner read/write only) for security.
 *
 * @param keyData - Key data to persist
 * @param options - Persistence options
 * @returns true if save succeeded, false otherwise
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` and call `set(asymmetricKeyData)` instead.
 */
export async function saveDevKey(keyData: DevKeyData, options?: DevKeyPersistenceOptions): Promise<boolean> {
  if (!isDevKeyPersistenceEnabled(options)) {
    return true; // Not enabled is not a failure
  }

  const keyPath = resolveKeyPath(options);
  const dir = path.dirname(keyPath);
  const tempPath = `${keyPath}.tmp.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;

  try {
    // Ensure directory exists with restricted permissions
    await mkdir(dir, { recursive: true, mode: 0o700 });

    // Write to temp file first (atomic write pattern)
    const content = JSON.stringify(keyData, null, 2);
    await writeFile(tempPath, content, { mode: 0o600 });

    // Atomic rename to target path
    await rename(tempPath, keyPath);

    console.log(`[DevKeyPersistence] Saved key (kid=${keyData.kid}) to ${keyPath}`);
    return true;
  } catch (error: unknown) {
    console.error(`[DevKeyPersistence] Failed to save key to ${keyPath}: ${(error as Error).message}`);
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
 * Delete persisted dev key
 *
 * @param options - Persistence options
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` and call `delete(kid)` instead.
 */
export async function deleteDevKey(options?: DevKeyPersistenceOptions): Promise<void> {
  const keyPath = resolveKeyPath(options);

  try {
    await unlink(keyPath);
    console.log(`[DevKeyPersistence] Deleted key at ${keyPath}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[DevKeyPersistence] Failed to delete key at ${keyPath}: ${(error as Error).message}`);
    }
  }
}
