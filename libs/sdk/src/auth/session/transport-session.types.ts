// auth/session/transport-session.types.ts

import { z } from 'zod';

/**
 * Transport protocol types supported by MCP
 * These are the actual transport protocols for sessions (excludes 'delete-session' action)
 */
export type TransportProtocol = 'legacy-sse' | 'sse' | 'streamable-http' | 'stateful-http' | 'stateless-http';

/**
 * Session storage mode for distributed systems
 */
export type SessionStorageMode = 'stateless' | 'stateful';

/**
 * TransportSession represents a single client connection.
 * Multiple sessions can share the same authorization.
 * Each session is bound to a specific transport protocol.
 */
export interface TransportSession {
  /** Unique session ID (encrypted JWT or UUID) */
  id: string;

  /** Reference to the authorization this session uses */
  authorizationId: string;

  /** Transport protocol for this session */
  protocol: TransportProtocol;

  /** Session creation timestamp (epoch ms) */
  createdAt: number;

  /** Session expiration (epoch ms, independent of auth expiration) */
  expiresAt?: number;

  /** Node ID for distributed systems */
  nodeId: string;

  /** Client fingerprint for rate limiting/tracking */
  clientFingerprint?: string;

  /** Transport-specific state */
  transportState?: TransportState;
}

/**
 * Transport-specific state that varies by protocol
 */
export type TransportState =
  | SseTransportState
  | StreamableHttpTransportState
  | StatefulHttpTransportState
  | StatelessHttpTransportState
  | LegacySseTransportState;

/**
 * SSE (Server-Sent Events) transport state
 */
export interface SseTransportState {
  type: 'sse';
  /** Last event ID for reconnection (per SSE spec) */
  lastEventId?: string;
  /** Connection keep-alive timestamp */
  lastPing?: number;
  /** Connection state */
  connectionState?: 'connecting' | 'open' | 'closed';
}

/**
 * Streamable HTTP transport state
 */
export interface StreamableHttpTransportState {
  type: 'streamable-http';
  /** Request sequence number */
  requestSeq: number;
  /** Active stream ID if streaming */
  activeStreamId?: string;
  /** Pending request IDs */
  pendingRequests?: string[];
}

/**
 * Stateful HTTP transport state
 */
export interface StatefulHttpTransportState {
  type: 'stateful-http';
  /** Request sequence number */
  requestSeq: number;
  /** Pending responses awaiting delivery */
  pendingResponses?: string[];
  /** Last activity timestamp */
  lastActivity?: number;
}

/**
 * Stateless HTTP transport state
 */
export interface StatelessHttpTransportState {
  type: 'stateless-http';
  /** Request count for rate limiting */
  requestCount: number;
  /** Window start for rate limiting */
  windowStart?: number;
}

/**
 * Legacy SSE transport state (for backwards compatibility)
 */
export interface LegacySseTransportState {
  type: 'legacy-sse';
  /** Message endpoint path */
  messagePath: string;
  /** Last event ID */
  lastEventId?: string;
  /** Connection state */
  connectionState?: 'connecting' | 'open' | 'closed';
}

/**
 * Session JWT payload - encodes both auth ref and transport context
 * This is the structure encrypted in the mcp-session-id header
 */
export interface SessionJwtPayload {
  /** Session ID (UUID) */
  sid: string;
  /** Authorization ID (token signature fingerprint) */
  aid: string;
  /** Transport protocol */
  proto: TransportProtocol;
  /** Node ID (for distributed systems) */
  nid: string;
  /** Issued at (epoch seconds) */
  iat: number;
  /** Expiration (epoch seconds) */
  exp?: number;
}

/**
 * Extended session JWT payload for stateless mode
 * Includes encrypted state and tokens
 */
export interface StatelessSessionJwtPayload extends SessionJwtPayload {
  /** Encrypted transport state (AES-256-GCM) */
  state?: string;
  /** Encrypted provider tokens (AES-256-GCM, for orchestrated mode) */
  tokens?: string;
}

/**
 * Stored session record (for stateful mode in Redis/memory)
 */
export interface StoredSession {
  /** The transport session data */
  session: TransportSession;
  /** Authorization ID reference */
  authorizationId: string;
  /** Encrypted provider tokens (for orchestrated mode) */
  tokens?: Record<string, EncryptedBlob>;
  /** Creation timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  lastAccessedAt: number;
}

/**
 * Encrypted blob structure (AES-256-GCM)
 */
export interface EncryptedBlob {
  /** Algorithm identifier */
  alg: 'A256GCM';
  /** Key ID (for rotation) */
  kid?: string;
  /** Initialization vector (base64url) */
  iv: string;
  /** Authentication tag (base64url) */
  tag: string;
  /** Ciphertext (base64url) */
  data: string;
  /** Expiration hint (epoch seconds) */
  exp?: number;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

/**
 * Session store interface for stateful sessions
 */
export interface SessionStore {
  /**
   * Get a stored session by ID
   */
  get(sessionId: string): Promise<StoredSession | null>;

  /**
   * Store a session with optional TTL
   */
  set(sessionId: string, session: StoredSession, ttlMs?: number): Promise<void>;

  /**
   * Delete a session
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Check if a session exists
   */
  exists(sessionId: string): Promise<boolean>;

  /**
   * Allocate a new session ID
   */
  allocId(): string;
}

/**
 * Session storage configuration
 */
export type SessionStorageConfig =
  | { mode: 'stateless' }
  | { mode: 'stateful'; store: 'memory' }
  | { mode: 'stateful'; store: 'redis'; config: RedisConfig };

/**
 * Redis configuration
 */
export interface RedisConfig {
  host: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  keyPrefix?: string;
}

// ============================================
// Zod Schemas
// ============================================

export const transportProtocolSchema = z.enum([
  'legacy-sse',
  'sse',
  'streamable-http',
  'stateful-http',
  'stateless-http',
]);

export const sseTransportStateSchema = z.object({
  type: z.literal('sse'),
  lastEventId: z.string().optional(),
  lastPing: z.number().optional(),
  connectionState: z.enum(['connecting', 'open', 'closed']).optional(),
});

export const streamableHttpTransportStateSchema = z.object({
  type: z.literal('streamable-http'),
  requestSeq: z.number(),
  activeStreamId: z.string().optional(),
  pendingRequests: z.array(z.string()).optional(),
});

export const statefulHttpTransportStateSchema = z.object({
  type: z.literal('stateful-http'),
  requestSeq: z.number(),
  pendingResponses: z.array(z.string()).optional(),
  lastActivity: z.number().optional(),
});

export const statelessHttpTransportStateSchema = z.object({
  type: z.literal('stateless-http'),
  requestCount: z.number(),
  windowStart: z.number().optional(),
});

export const legacySseTransportStateSchema = z.object({
  type: z.literal('legacy-sse'),
  messagePath: z.string(),
  lastEventId: z.string().optional(),
  connectionState: z.enum(['connecting', 'open', 'closed']).optional(),
});

export const transportStateSchema = z.discriminatedUnion('type', [
  sseTransportStateSchema,
  streamableHttpTransportStateSchema,
  statefulHttpTransportStateSchema,
  statelessHttpTransportStateSchema,
  legacySseTransportStateSchema,
]);

export const transportSessionSchema = z.object({
  id: z.string(),
  authorizationId: z.string(),
  protocol: transportProtocolSchema,
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  nodeId: z.string(),
  clientFingerprint: z.string().optional(),
  transportState: transportStateSchema.optional(),
});

export const sessionJwtPayloadSchema = z.object({
  sid: z.string(),
  aid: z.string(),
  proto: transportProtocolSchema,
  nid: z.string(),
  iat: z.number(),
  exp: z.number().optional(),
});

export const statelessSessionJwtPayloadSchema = sessionJwtPayloadSchema.extend({
  state: z.string().optional(),
  tokens: z.string().optional(),
});

export const encryptedBlobSchema = z.object({
  alg: z.literal('A256GCM'),
  kid: z.string().optional(),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
  exp: z.number().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const storedSessionSchema = z.object({
  session: transportSessionSchema,
  authorizationId: z.string(),
  tokens: z.record(encryptedBlobSchema).optional(),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
});

export const redisConfigSchema = z.object({
  host: z.string(),
  port: z.number().optional().default(6379),
  password: z.string().optional(),
  db: z.number().optional().default(0),
  tls: z.boolean().optional().default(false),
  keyPrefix: z.string().optional().default('mcp:session:'),
});

// Stateful storage options (discriminated by store type)
const statefulStorageSchema = z.discriminatedUnion('store', [
  z.object({ store: z.literal('memory') }),
  z.object({ store: z.literal('redis'), config: redisConfigSchema }),
]);

// Session storage config using union instead of discriminatedUnion
// to avoid duplicate mode values
export const sessionStorageConfigSchema = z.union([
  z.object({ mode: z.literal('stateless') }),
  z.object({ mode: z.literal('stateful') }).merge(statefulStorageSchema.options[0]),
  z.object({ mode: z.literal('stateful') }).merge(statefulStorageSchema.options[1]),
]);
