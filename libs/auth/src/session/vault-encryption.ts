/**
 * Vault Encryption
 *
 * Client-side key derivation for zero-knowledge credential storage.
 *
 * Security Model:
 * - The JWT authorization token contains a unique `jti` (JWT ID) claim
 * - A secret portion of the token (or a derived key) is used as the encryption key
 * - The server stores encrypted blobs in Redis but CANNOT decrypt them
 * - Only the client presenting the valid JWT can decrypt their vault
 *
 * Key Derivation:
 * - Input: JWT token (after signature verification)
 * - Extract: jti + a secret claim (e.g., `vaultKey` or derived from signature)
 * - Derive: HKDF-SHA256 to produce AES-256 key
 *
 * Encryption:
 * - Algorithm: AES-256-GCM (authenticated encryption)
 * - IV: Random 12 bytes per encryption (stored with ciphertext)
 * - Auth Tag: 16 bytes (ensures integrity)
 */

import { z } from 'zod';
import { hkdfSha256, encryptAesGcm, decryptAesGcm, randomBytes } from '@frontmcp/utils';

// ============================================
// Types and Schemas
// ============================================

/**
 * Encrypted data format stored in Redis
 */
export const encryptedDataSchema = z.object({
  /** Version for future algorithm changes */
  v: z.literal(1),
  /** Algorithm identifier */
  alg: z.literal('aes-256-gcm'),
  /** Initialization vector (base64) */
  iv: z.string(),
  /** Ciphertext (base64) */
  ct: z.string(),
  /** Authentication tag (base64) */
  tag: z.string(),
});

export type EncryptedData = z.infer<typeof encryptedDataSchema>;

/**
 * JWT claims required for key derivation
 */
export interface VaultKeyDerivationClaims {
  /** JWT ID - unique identifier for this token/vault */
  jti: string;
  /** Vault key material - secret claim added during token generation */
  vaultKey?: string;
  /** Subject - user identifier */
  sub: string;
  /** Issued at timestamp */
  iat: number;
}

/**
 * Vault encryption configuration
 */
export interface VaultEncryptionConfig {
  /**
   * Server-side pepper added to key derivation
   * This adds defense-in-depth: even with a stolen JWT,
   * attacker needs the pepper to derive the key
   */
  pepper?: string;
  /**
   * Key derivation info string for HKDF
   * Allows domain separation between different uses
   */
  hkdfInfo?: string;
}

// ============================================
// Vault Encryption Class
// ============================================

/**
 * VaultEncryption handles encryption/decryption of vault credentials
 * using keys derived from the client's JWT authorization token.
 *
 * @example
 * ```typescript
 * const encryption = new VaultEncryption({ pepper: process.env.VAULT_PEPPER });
 *
 * // After JWT verification, derive the encryption key
 * const key = await encryption.deriveKey(jwtClaims);
 *
 * // Encrypt credentials before storing
 * const encrypted = await encryption.encrypt(JSON.stringify(credentials), key);
 *
 * // Decrypt when reading
 * const decrypted = await encryption.decrypt(encrypted, key);
 * const credentials = JSON.parse(decrypted);
 * ```
 */
export class VaultEncryption {
  private readonly pepper: Uint8Array;
  private readonly hkdfInfo: string;

  constructor(config: VaultEncryptionConfig = {}) {
    // Convert pepper to Uint8Array, use empty if not provided
    this.pepper = new TextEncoder().encode(config.pepper ?? '');
    this.hkdfInfo = config.hkdfInfo ?? 'frontmcp-vault-v1';
  }

  /**
   * Derive an encryption key from JWT claims
   *
   * The key derivation uses HKDF:
   * 1. Combine jti + vaultKey + sub + iat + pepper as IKM
   * 2. Apply HKDF-SHA256 to derive a 256-bit key
   *
   * @param claims - JWT claims containing key material
   * @returns 32-byte encryption key as Uint8Array
   */
  async deriveKey(claims: VaultKeyDerivationClaims): Promise<Uint8Array> {
    // Build the input key material (IKM)
    // Using multiple claims ensures the key is unique per token
    const ikmParts = [
      claims.jti,
      claims.vaultKey ?? '',
      claims.sub,
      claims.iat.toString(),
      new TextDecoder().decode(this.pepper),
    ];
    const ikm = new TextEncoder().encode(ikmParts.join(''));

    // Use HKDF-SHA256 to derive the key
    const infoBytes = new TextEncoder().encode(this.hkdfInfo);
    const key = await hkdfSha256(ikm, new Uint8Array(0), infoBytes, 32);
    return key;
  }

  /**
   * Derive a key directly from the raw JWT token string
   *
   * This is useful when you want to derive the key from the token
   * before or without fully parsing the claims. Uses the token's
   * signature portion as additional entropy.
   *
   * @param token - The raw JWT token string
   * @param claims - Parsed JWT claims
   * @returns 32-byte encryption key as Uint8Array
   */
  async deriveKeyFromToken(token: string, claims: VaultKeyDerivationClaims): Promise<Uint8Array> {
    // Extract signature from JWT (last part after final dot)
    const parts = token.split('.');
    const signature = parts[2] ?? '';

    // Include signature in key derivation for additional entropy
    const ikmParts = [
      claims.jti,
      claims.vaultKey ?? '',
      claims.sub,
      claims.iat.toString(),
      signature,
      new TextDecoder().decode(this.pepper),
    ];
    const ikm = new TextEncoder().encode(ikmParts.join(''));

    // Use HKDF-SHA256 to derive the key
    const infoBytes = new TextEncoder().encode(this.hkdfInfo);
    const key = await hkdfSha256(ikm, new Uint8Array(0), infoBytes, 32);
    return key;
  }

  /**
   * Encrypt plaintext data using AES-256-GCM
   *
   * @param plaintext - Data to encrypt (typically JSON string)
   * @param key - 32-byte encryption key from deriveKey()
   * @returns Encrypted data object (safe to store in Redis)
   */
  async encrypt(plaintext: string, key: Uint8Array): Promise<EncryptedData> {
    if (key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes');
    }

    // Generate random 12-byte IV (recommended for GCM)
    const iv = randomBytes(12);

    // Encrypt using AES-256-GCM
    const { ciphertext, tag } = await encryptAesGcm(key, iv, new TextEncoder().encode(plaintext));

    return {
      v: 1,
      alg: 'aes-256-gcm',
      iv: Buffer.from(iv).toString('base64'),
      ct: Buffer.from(ciphertext).toString('base64'),
      tag: Buffer.from(tag).toString('base64'),
    };
  }

  /**
   * Decrypt encrypted data using AES-256-GCM
   *
   * @param encrypted - Encrypted data object from encrypt()
   * @param key - 32-byte encryption key from deriveKey()
   * @returns Decrypted plaintext
   * @throws Error if decryption fails (wrong key, tampered data, etc.)
   */
  async decrypt(encrypted: EncryptedData, key: Uint8Array): Promise<string> {
    if (key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes');
    }

    // Validate encrypted data format
    const parsed = encryptedDataSchema.safeParse(encrypted);
    if (!parsed.success) {
      throw new Error('Invalid encrypted data format');
    }

    const { iv, ct, tag } = parsed.data;

    // Decode from base64
    const ivBuffer = new Uint8Array(Buffer.from(iv, 'base64'));
    const ciphertext = new Uint8Array(Buffer.from(ct, 'base64'));
    const tagBuffer = new Uint8Array(Buffer.from(tag, 'base64'));

    // Decrypt
    try {
      const plaintext = await decryptAesGcm(key, ivBuffer, ciphertext, tagBuffer);
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      // GCM authentication failed - wrong key or tampered data
      throw new Error('Decryption failed: invalid key or corrupted data');
    }
  }

  /**
   * Encrypt a JavaScript object (serializes to JSON first)
   *
   * @param data - Object to encrypt
   * @param key - Encryption key
   * @returns Encrypted data
   */
  async encryptObject<T>(data: T, key: Uint8Array): Promise<EncryptedData> {
    return this.encrypt(JSON.stringify(data), key);
  }

  /**
   * Decrypt and parse a JavaScript object
   *
   * @param encrypted - Encrypted data
   * @param key - Encryption key
   * @returns Decrypted and parsed object
   */
  async decryptObject<T>(encrypted: EncryptedData, key: Uint8Array): Promise<T> {
    const plaintext = await this.decrypt(encrypted, key);
    return JSON.parse(plaintext) as T;
  }

  /**
   * Check if data is in encrypted format
   *
   * @param data - Data to check
   * @returns True if data appears to be encrypted
   */
  isEncrypted(data: unknown): data is EncryptedData {
    return encryptedDataSchema.safeParse(data).success;
  }
}

// ============================================
// Encrypted Vault Entry Schema
// ============================================

/**
 * Vault entry with encrypted credentials
 *
 * The structure separates:
 * - Metadata (unencrypted): id, userSub, timestamps, app lists
 * - Sensitive data (encrypted): provider tokens, app credentials
 */
export const encryptedVaultEntrySchema = z.object({
  /** Vault ID (maps to JWT jti claim) */
  id: z.string(),
  /** User subject identifier */
  userSub: z.string(),
  /** User email (unencrypted for display) */
  userEmail: z.string().optional(),
  /** User name (unencrypted for display) */
  userName: z.string().optional(),
  /** Client ID that created this session */
  clientId: z.string(),
  /** Creation timestamp */
  createdAt: z.number(),
  /** Last access timestamp */
  lastAccessAt: z.number(),
  /** Encrypted sensitive data (provider tokens, credentials, consent) */
  encryptedData: encryptedDataSchema,
  /** Apps that are fully authorized (unencrypted for quick lookup) */
  authorizedAppIds: z.array(z.string()),
  /** Apps that were skipped (unencrypted for quick lookup) */
  skippedAppIds: z.array(z.string()),
  /** Pending auth IDs (unencrypted for lookup, actual URLs encrypted) */
  pendingAuthIds: z.array(z.string()).default([]),
});

export type EncryptedVaultEntry = z.infer<typeof encryptedVaultEntrySchema>;

/**
 * Sensitive data that gets encrypted
 */
export interface VaultSensitiveData {
  /** App credentials */
  appCredentials: Record<string, unknown>;
  /** Consent record */
  consent?: unknown;
  /** Federated login record */
  federated?: unknown;
  /** Pending auth details (URLs, scopes, etc.) */
  pendingAuths: unknown[];
}
