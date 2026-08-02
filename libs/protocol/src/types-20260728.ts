/**
 * MCP protocol revision **2026-07-28**.
 *
 * The upstream `@modelcontextprotocol/sdk` (1.30.0 at time of writing) only
 * ships schemas up to `2025-11-25`, so this revision is defined here — inside
 * the single boundary module that owns protocol types — rather than reached for
 * from every call site. When upstream catches up, this file is the only place
 * that has to change.
 *
 * Everything here is ADDITIVE. The 2025-and-earlier types re-exported from
 * `./types` are untouched, because a server must keep serving both eras.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/changelog
 */

import type { Implementation, LoggingLevel, RequestId } from './types';

/** The protocol revision this module implements. */
export const PROTOCOL_2026_07_28 = '2026-07-28' as const;

export type Protocol20260728Version = typeof PROTOCOL_2026_07_28;

/**
 * Reserved `_meta` keys introduced by 2026-07-28.
 *
 * Statelessness means the handshake's payload now rides on every request, so
 * these keys carry what `initialize` used to negotiate once.
 */
export const MCP_20260728_META = {
  /** Request: protocol version; MUST match the `MCP-Protocol-Version` header. */
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  /** Request: self-reported client identity. */
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  /** Request: capabilities for THIS request only — never inferred from prior ones. */
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  /** Request: opt-in log level; absent means "send me no `notifications/message`". */
  logLevel: 'io.modelcontextprotocol/logLevel',
  /** Result: self-reported server identity. */
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  /** Notification/result: id of the `subscriptions/listen` stream it belongs to. */
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const;

/**
 * JSON-RPC error codes allocated to the MCP specification.
 *
 * 2026-07-28 partitions the server-error range: `-32000`…`-32019` stays
 * implementation-defined, `-32020`…`-32099` is reserved for the spec. The three
 * codes below were renumbered into that block from their draft values.
 */
export const MCP_20260728_ERROR_CODES = {
  /** Headers disagree with the body, or a required header is missing/malformed. */
  headerMismatch: -32020,
  /** The request needs a client capability that was not declared. */
  missingRequiredClientCapability: -32021,
  /** The requested protocol version is not supported by this server. */
  unsupportedProtocolVersion: -32022,
} as const;

/**
 * Codes retired by this revision. Kept as documentation so they are never
 * reallocated: `-32002` was resource-not-found (now `-32602`) and `-32042` was
 * URL-elicitation-required (2025-11-25 only).
 */
export const MCP_20260728_RETIRED_ERROR_CODES = [-32002, -32042] as const;

/** Methods this revision removed from the core protocol. */
export const MCP_20260728_REMOVED_METHODS = [
  'initialize',
  'notifications/initialized',
  'ping',
  'logging/setLevel',
  'notifications/roots/list_changed',
  'resources/subscribe',
  'resources/unsubscribe',
  'tasks/list',
  'tasks/result',
] as const;

/** Methods this revision introduced. */
export const MCP_20260728_ADDED_METHODS = ['server/discover', 'subscriptions/listen'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Common shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminates a final result from an interim one.
 *
 * Left open (`| string`) exactly as the spec does, so a future result type does
 * not become a parse error.
 */
export type ResultType = 'complete' | 'input_required' | (string & {});

export interface RequestMeta20260728 {
  progressToken?: string | number;
  [MCP_20260728_META.protocolVersion]: string;
  [MCP_20260728_META.clientInfo]?: Implementation;
  [MCP_20260728_META.clientCapabilities]: ClientCapabilities20260728;
  [MCP_20260728_META.logLevel]?: LoggingLevel;
  [key: string]: unknown;
}

export interface ResultMeta20260728 {
  [MCP_20260728_META.serverInfo]?: Implementation;
  [key: string]: unknown;
}

export interface NotificationMeta20260728 {
  [MCP_20260728_META.subscriptionId]?: RequestId;
  [key: string]: unknown;
}

export interface Result20260728 {
  _meta?: ResultMeta20260728;
  resultType: ResultType;
  [key: string]: unknown;
}

/**
 * A result carrying client-side caching hints.
 *
 * REQUIRED on `tools/list`, `prompts/list`, `resources/list`,
 * `resources/templates/list`, `resources/read`, and `server/discover`.
 */
export interface CacheableResult extends Result20260728 {
  /** Freshness hint in milliseconds; `0` means "always revalidate". */
  ttlMs: number;
  /** `public` = safe to share across authorization contexts; `private` = not. */
  cacheScope: 'public' | 'private';
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientCapabilities20260728 {
  experimental?: Record<string, Record<string, unknown>>;
  /** @deprecated Deprecated in 2026-07-28 (SEP-2577). */
  roots?: Record<string, unknown>;
  /** @deprecated Deprecated in 2026-07-28 (SEP-2577). */
  sampling?: { context?: Record<string, unknown>; tools?: Record<string, unknown> };
  elicitation?: { form?: Record<string, unknown>; url?: Record<string, unknown> };
  /** Optional MCP extensions; keys are prefixed identifiers. */
  extensions?: Record<string, Record<string, unknown>>;
}

export interface ServerCapabilities20260728 {
  experimental?: Record<string, Record<string, unknown>>;
  /** @deprecated Deprecated in 2026-07-28 (SEP-2577). */
  logging?: Record<string, unknown>;
  completions?: Record<string, unknown>;
  prompts?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  tools?: { listChanged?: boolean };
  /** Optional MCP extensions; keys are prefixed identifiers. */
  extensions?: Record<string, Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// server/discover
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverResult extends CacheableResult {
  /** Versions the client may choose from for subsequent requests. */
  supportedVersions: string[];
  capabilities: ServerCapabilities20260728;
  instructions?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// subscriptions/listen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The notification types a client opts in to. Every type is opt-in: the server
 * MUST NOT push a type the client did not ask for.
 */
export interface SubscriptionFilter {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  /** Replaces the removed `resources/subscribe` RPC. */
  resourceSubscriptions?: string[];
}

export interface SubscriptionsListenParams {
  notifications: SubscriptionFilter;
  _meta: RequestMeta20260728;
}

export interface SubscriptionsAcknowledgedParams {
  /** The subset of requested types the server actually agreed to honor. */
  notifications: SubscriptionFilter;
  _meta?: NotificationMeta20260728;
}

export const SUBSCRIPTIONS_ACKNOWLEDGED_METHOD = 'notifications/subscriptions/acknowledged' as const;

// ─────────────────────────────────────────────────────────────────────────────
// Multi Round-Trip Requests (MRTR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A server-initiated request embedded in a result rather than sent on the wire.
 *
 * 2026-07-28 removed the server→client request direction, so sampling,
 * elicitation, and roots all travel this way.
 */
export interface InputRequest {
  method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list' | (string & {});
  params?: Record<string, unknown>;
}

export type InputRequests = Record<string, InputRequest>;

export type InputResponses = Record<string, Record<string, unknown>>;

/**
 * The interim result that asks the client for more input.
 *
 * At least one of `inputRequests` / `requestState` MUST be present. The client
 * retries the ORIGINAL request with `inputResponses` and the echoed
 * `requestState`; it must treat `requestState` as opaque.
 */
export interface InputRequiredResult extends Result20260728 {
  resultType: 'input_required';
  inputRequests?: InputRequests;
  requestState?: string;
}

/** Params any client request may carry when resuming an MRTR exchange. */
export interface InputResponseParams {
  inputResponses?: InputResponses;
  requestState?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

/** True when `version` is the 2026-07-28 revision. */
export function isProtocol20260728(version: unknown): version is Protocol20260728Version {
  return version === PROTOCOL_2026_07_28;
}

/** Reads the protocol version a request declares in its `_meta`, if any. */
export function readDeclaredProtocolVersion(body: unknown): string | undefined {
  const params = (body as { params?: { _meta?: Record<string, unknown> } } | undefined)?.params;
  const declared = params?._meta?.[MCP_20260728_META.protocolVersion];
  return typeof declared === 'string' ? declared : undefined;
}
