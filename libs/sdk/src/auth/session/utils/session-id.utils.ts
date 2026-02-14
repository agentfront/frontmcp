// auth/session/utils/session-id.utils.ts
//
// This file STAYS in SDK because createSessionId depends on SDK-specific
// detectPlatformFromUserAgent and PlatformDetectionConfig.
// Crypto utils (encryptJson, decryptSessionJson, etc.) are now in @frontmcp/auth.

import { randomUUID } from '@frontmcp/utils';
import { TinyTtlCache, getTokenSignatureFingerprint, encryptJson, safeDecrypt } from '@frontmcp/auth';
import type { SessionIdPayload, TransportProtocolType, AIPlatformType } from '@frontmcp/auth';
import { detectPlatformFromUserAgent } from '../../../notification/notification.service';
import type { PlatformDetectionConfig } from '../../../common/types/options/session';
import { getMachineId } from '@frontmcp/auth';

// 5s TTL cache for decrypted headers
const cache = new TinyTtlCache<string, SessionIdPayload>(5000);

/**
 * Validates the structure of a session payload without signature verification.
 * Use this for structural validation only (e.g., when updating an existing session).
 */
function hasValidSessionStructure(dec: unknown): dec is SessionIdPayload {
  if (typeof dec !== 'object' || dec === null) return false;
  const d = dec as Record<string, unknown>;
  return (
    typeof d['nodeId'] === 'string' &&
    typeof d['authSig'] === 'string' &&
    typeof d['uuid'] === 'string' &&
    typeof d['iat'] === 'number'
  );
}

/**
 * Validates a session payload including signature verification.
 * Use this when verifying a session against an expected auth signature.
 */
function isValidSessionPayload(dec: unknown, sig: string): dec is SessionIdPayload {
  return hasValidSessionStructure(dec) && dec.authSig === sig;
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
}

export interface CreateSessionOptions {
  /** User-Agent header for pre-initialize platform detection */
  userAgent?: string;
  /** Platform detection configuration from scope */
  platformDetectionConfig?: PlatformDetectionConfig;
  /**
   * Whether this session is in skills-only mode.
   * When true, tools/list returns empty array but skills/search and skills/load work normally.
   * Detected from `?mode=skills_only` query param on connection.
   */
  skillsOnlyMode?: boolean;
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
    // Add skillsOnlyMode if provided
    ...(options?.skillsOnlyMode && { skillsOnlyMode: true }),
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
  if (hasValidSessionStructure(decrypted) || isValidPublicSessionPayload(decrypted)) {
    const payload = decrypted as SessionIdPayload;
    Object.assign(payload, updates);
    cache.set(sessionId, payload);
    return true;
  }

  return false;
}

/**
 * Retrieve client info (name/version) from a session ID.
 * Useful for logging, stateless access, or when NotificationService is not available.
 *
 * @param sessionId - The encrypted session ID
 * @returns Client info object or null if session is invalid or has no client info
 */
export function getSessionClientInfo(sessionId: string): { name?: string; version?: string } | null {
  // Check cache first (may have updated client info from initialize)
  const cached = cache.get(sessionId);
  if (cached && hasValidSessionStructure(cached)) {
    return { name: cached.clientName, version: cached.clientVersion };
  }

  // Fall back to decrypting from the encrypted session ID
  const decrypted = safeDecrypt(sessionId);
  if (hasValidSessionStructure(decrypted) || isValidPublicSessionPayload(decrypted)) {
    const payload = decrypted as SessionIdPayload;
    // Cache for subsequent access
    cache.set(sessionId, payload);
    return { name: payload.clientName, version: payload.clientVersion };
  }

  return null;
}
