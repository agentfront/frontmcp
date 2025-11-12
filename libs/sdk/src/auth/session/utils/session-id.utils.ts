// auth/session/utils/session-id.utils.ts
import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { TinyTtlCache } from './tiny-ttl-cache';
import { HttpRequestIntent, SessionIdPayload } from '../../../common';
import { getTokenSignatureFingerprint } from './auth-token.utils';

// 5s TTL cache for decrypted headers
const cache = new TinyTtlCache<string, SessionIdPayload>(5000);

// Single-process machine id generated at server launch
const MACHINE_ID = (() => {
  // Prefer an injected env (stable across restarts) if you have one; else random per launch:
  return process.env['MACHINE_ID'] || randomUUID(); // TODO: move to gateway config module
})();

// Symmetric key derived from secret or machine id (stable for the process)
function getKey(): Buffer {
  const base = process.env['MCP_SESSION_SECRET'] || MACHINE_ID; // TODO: move to gateway config module
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

function decryptSessionId(sessionId: string, sig: string): SessionIdPayload | null {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = sessionId.split('.');
  if (!ivB64 || !tagB64 || !ctB64) return null;
  try {
    const iv = b64urlDecode(ivB64);
    const tag = b64urlDecode(tagB64);
    const ct = b64urlDecode(ctB64);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const dec = JSON.parse(pt.toString('utf8'));
    if (
      typeof dec.nodeId === 'string' &&
      typeof dec.authSig === 'string' &&
      typeof dec.uuid === 'string' &&
      typeof dec.iat === 'number' &&
      dec.authSig === sig
    ) {
      return dec;
    }

    throw new Error('Invalid session id');
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

export function createSessionId(protocol: HttpRequestIntent, token: string) {
  const authSig = getTokenSignatureFingerprint(token);
  const payload: SessionIdPayload = {
    nodeId: MACHINE_ID,
    authSig,
    uuid: randomUUID(),
    iat: nowSec(),
    protocol,
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


