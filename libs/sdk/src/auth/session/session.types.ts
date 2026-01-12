// auth/session/session.types.ts

import { SessionUser } from './record/session.base';

/** Session mode identifier. */
export type SessionMode = 'mcp';

/**
 * How a single provider’s access token is represented inside the session payload.
 */
export type ProviderEmbedMode =
  | 'store-only' // stateful, encrypted in memory store
  | 'encrypted' // stateless, encrypted in JWT/session-secret
  | 'plain' // stateless, plaintext (in-memory only)
  | 'ref'; // NEW: external vault/store by reference

/** AES-256-GCM encrypted blob, base64url fields. */
export type EncBlob = { alg: 'A256GCM'; iv: string; tag: string; data: string };

export type ProviderSnapshot = {
  id: string;
  exp?: number;
  payload?: Record<string, unknown>;
  apps?: Array<{ id: string; toolIds?: string[] }>;
  embedMode: ProviderEmbedMode;

  // legacy fields (keep for back-compat)
  token?: string; // in-memory only, for 'plain'
  tokenEnc?: { alg: 'A256GCM'; iv: string; tag: string; data: string }; // for 'encrypted' or 'store-only'
  refreshTokenEnc?: { alg: 'A256GCM'; iv: string; tag: string; data: string };

  // NEW: externalized refs
  secretRefId?: string; // access token reference
  refreshRefId?: string; // refresh token reference
};

/** Arguments required to create a session from verified auth data. */
export type CreateSessionArgs = {
  token: string;
  sessionId?: string;
  claims: Record<string, any>;
  user: SessionUser;
  // Optional precomputed authorization projections (preferred when provided)
  authorizedProviders?: Record<string, import('./session.types').ProviderSnapshot>;
  authorizedProviderIds?: string[];
  authorizedApps?: Record<string, { id: string; toolIds: string[] }>;
  authorizedAppIds?: string[];
  authorizedResources?: string[];
  scopes?: string[];
  // Scoped tool/prompt projections for fast lookup
  authorizedTools?: Record<string, { executionPath: [string, string]; details?: Record<string, any> }>;
  authorizedToolIds?: string[];
  authorizedPrompts?: Record<string, { executionPath: [string, string]; details?: Record<string, any> }>;
  authorizedPromptIds?: string[];
};
