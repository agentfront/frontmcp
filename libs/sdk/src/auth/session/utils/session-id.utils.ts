// auth/session/utils/session-id.utils.ts
import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { TinyTtlCache } from './tiny-ttl-cache';
import { SessionIdPayload, TransportProtocolType, AIPlatformType } from '../../../common';
import { getTokenSignatureFingerprint } from './auth-token.utils';
import { detectPlatformFromUserAgent } from '../../../notification/notification.service';
import type { PlatformDetectionConfig } from '../../../common/types/options/session.options';
import { getMachineId } from '../../machine-id';

// 5s TTL cache for decrypted headers
const cache = new TinyTtlCache<string, SessionIdPayload>(5000);

// Symmetric key derived from secret or machine id (stable for the process)
// Uses getMachineId() from authorization module as single source of truth
function getKey(): Buffer {
  const base = process.env['MCP_SESSION_SECRET'] || getMachineId();
  return createHash('sha256').update(base).digest(); // 32 bytes
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4);
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(base64, 'base64');
}

export function encryptJson(obj: unknown): string {
  const key = getKey();
  const iv = randomBytes(12); // AES-GCM 96-bit IV
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack iv.tag.ct as base64url(iv.tag.ct)
  return `${b64urlEncode(iv)}.${b64urlEncode(tag)}.${b64urlEncode(ct)}`;
}

/**
 * Low-level decryption that returns the raw JSON payload or null.
 * Handles all crypto/parsing failures by returning null.
 */
function decryptSessionJson(sessionId: string): unknown {
  const parts = sessionId.split('.');
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) return null;

  const key = getKey();
  const iv = b64urlDecode(ivB64);
  const tag = b64urlDecode(tagB64);
  const ct = b64urlDecode(ctB64);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

function isValidSessionPayload(dec: unknown, sig: string): dec is SessionIdPayload {
  if (typeof dec !== 'object' || dec === null) return false;
  const d = dec as Record<string, unknown>;
  return (
    typeof d['nodeId'] === 'string' &&
    typeof d['authSig'] === 'string' &&
    typeof d['uuid'] === 'string' &&
    typeof d['iat'] === 'number' &&
    d['authSig'] === sig
  );
}

function isValidPublicSessionPayload(dec: unknown): dec is SessionIdPayload {
  if (typeof dec !== 'object' || dec === null) return false;
  const d = dec as Record<string, unknown>;
  return (
    typeof d['nodeId'] === 'string' &&
    d['authSig'] === 'public' &&
    typeof d['uuid'] === 'string' &&
    typeof d['iat'] === 'number' &&
    d['isPublic'] === true
  );
}

function decryptSessionId(sessionId: string, sig: string): SessionIdPayload | null {
  const dec = safeDecrypt(sessionId);
  return isValidSessionPayload(dec, sig) ? dec : null;
}

/**
 * Decrypt a public session ID without signature verification.
 * Public sessions use authSig: 'public' and isPublic: true.
 * First checks the cache for potentially updated payload (e.g., platformType).
 */
export function decryptPublicSession(sessionId: string): SessionIdPayload | null {
  // Check cache first - may have updated fields like platformType
  const cached = cache.get(sessionId);
  if (cached && isValidPublicSessionPayload(cached)) {
    return cached;
  }

  // Fall back to decrypting from the encrypted session ID
  const dec = safeDecrypt(sessionId);
  if (isValidPublicSessionPayload(dec)) {
    // Cache the decrypted payload for future requests
    cache.set(sessionId, dec as SessionIdPayload);
    return dec as SessionIdPayload;
  }
  return null;
}

/**
 * Safe wrapper around decryptSessionJson that catches crypto/parse errors.
 */
function safeDecrypt(sessionId: string): unknown {
  try {
    return decryptSessionJson(sessionId);
  } catch {
    return null;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Validates an existing session header OR creates a fresh one.
 * - Valid: nodeId matches local, authSig matches current Authorization
 * - On any mismatch/decrypt error → generate new
 */
export function parseSessionHeader(
  sessionHeader: string | undefined,
  token: string,
): { id: string; payload: SessionIdPayload } | undefined {
  const currentAuthSig = getTokenSignatureFingerprint(token);
  if (sessionHeader) {
    const cached = cache.get(sessionHeader);
    if (cached) {
      if (cached.authSig === currentAuthSig) {
        return { id: sessionHeader, payload: cached };
      }
      // fallthrough to regenerate if mismatch
    }

    const dec = decryptSessionId(sessionHeader, currentAuthSig);
    if (dec) {
      cache.set(sessionHeader, dec);
      return { id: sessionHeader, payload: dec as SessionIdPayload };
    }
  }

  return undefined;
  // // Create fresh

  // const decodedSse: SessionIdPayload = {
  //   nodeId: MACHINE_ID,
  //   authSig: currentAuthSig,
  //   uuid: randomUUID(),
  //   iat: nowSec(),
  // };
  // const header = encryptJson(decoded);
  // const headerSse = encryptJson(decodedSse);
  // cache.set(header, decoded);
  // cache.set(headerSse, decodedSse);
  // return { header, decoded, headerSse, isNew: true };
}

export interface CreateSessionOptions {
  /** User-Agent header for pre-initialize platform detection */
  userAgent?: string;
  /** Platform detection configuration from scope */
  platformDetectionConfig?: PlatformDetectionConfig;
}

export function createSessionId(protocol: TransportProtocolType, token: string, options?: CreateSessionOptions) {
  const authSig = getTokenSignatureFingerprint(token);

  // Detect platform from user-agent if provided (before MCP initialize)
  let platformType: AIPlatformType | undefined;
  if (options?.userAgent) {
    platformType = detectPlatformFromUserAgent(options.userAgent, options.platformDetectionConfig);
    // Only set if we detected something meaningful
    if (platformType === 'unknown') {
      platformType = undefined;
    }
  }

  const payload: SessionIdPayload = {
    nodeId: getMachineId(),
    authSig,
    uuid: randomUUID(),
    iat: nowSec(),
    protocol,
    platformType,
  };
  const id = encryptJson(payload);
  cache.set(id, payload);
  return { id, payload };
}

export function generateSessionCookie(sessionId: string, ttlInMinutes = 60 * 24): string {
  const expires = new Date(Date.now() + ttlInMinutes * 60 * 1000).toUTCString();
  return `mcp_session_id=${sessionId}; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax`;
}

export function extractSessionFromCookie(cookie?: string): string | undefined {
  if (!cookie) return undefined;
  const m = cookie.match(/(^|;)\s*mcp_session_id\s*=\s*([^;]*)/);
  return m ? m[2] : undefined;
}

/**
 * Update a cached session payload with new data.
 * This is used to persist changes like platformType detection that happen
 * after the initial session creation.
 *
 * @param sessionId - The session ID to update
 * @param updates - Partial payload updates to merge
 * @returns true if the session was found and updated, false otherwise
 */
export function updateSessionPayload(sessionId: string, updates: Partial<SessionIdPayload>): boolean {
  const existing = cache.get(sessionId);
  if (existing) {
    // Merge updates into existing payload
    Object.assign(existing, updates);
    // Re-set to refresh TTL
    cache.set(sessionId, existing);
    return true;
  }

  // Try to decrypt and update if not in cache
  const decrypted = safeDecrypt(sessionId);
  if (
    isValidSessionPayload(decrypted, (decrypted as SessionIdPayload)?.authSig || '') ||
    isValidPublicSessionPayload(decrypted)
  ) {
    const payload = decrypted as SessionIdPayload;
    Object.assign(payload, updates);
    cache.set(sessionId, payload);
    return true;
  }

  return false;
}
