// common/types/options/session/interfaces.ts
// Explicit TypeScript interfaces for session configuration

import { AIPlatformType } from '../../auth/session.types';

/**
 * Session mode type.
 */
export type SessionMode = 'stateful' | 'stateless';

/**
 * A single platform mapping entry for custom client-to-platform detection.
 */
export interface PlatformMappingEntryInterface {
  /** Pattern to match against clientInfo.name (string for exact match, RegExp for pattern) */
  pattern: string | RegExp;
  /** The platform type to assign when pattern matches */
  platform: AIPlatformType;
}

/**
 * Configuration for platform detection from MCP client info.
 */
export interface PlatformDetectionConfigInterface {
  /**
   * Custom mappings to check before default detection.
   * Mappings are evaluated in order; first match wins.
   */
  mappings?: PlatformMappingEntryInterface[];
  /**
   * If true, skip default detection when no custom mapping matches.
   * The platform will be 'unknown' instead of attempting keyword-based detection.
   * @default false
   */
  customOnly?: boolean;
}

/**
 * Session configuration options.
 */
export interface SessionOptionsInterface {
  /**
   * Defines how the session lifecycle and nested tokens are managed.
   *
   * Modes:
   * - `'stateful'`: Session and nested tokens are stored in a server-side store (e.g., Redis).
   * - `'stateless'`: All session data (including nested tokens) is embedded within a signed/encrypted JWT.
   *
   * **Behavior:**
   * - When using `'stateful'`:
   *   - Nested OAuth tokens are **never exposed** in the JWT.
   *   - Tokens are encrypted and persisted in Redis under a session key.
   *   - The client receives only a lightweight reference (session key) instead of full credentials.
   *   - Results in smaller JWT payloads and reduces token leakage risk.
   *   - Allows seamless refresh of nested provider tokens without requiring user re-authorization.
   *   - Recommended for multi-application environments or setups using short-lived OAuth tokens.
   *
   * - When using `'stateless'`:
   *   - Stores all nested tokens directly within the JWT, enabling fully client-managed sessions.
   *   - Does **not support token refresh** — once a nested provider token expires, re-authorization is required.
   *   - Simplifies implementation but may degrade UX when tokens are short-lived.
   *   - Best suited for lightweight or single-application environments where token rotation is less critical.
   *
   * @default 'stateful'
   */
  sessionMode?: SessionMode | ((issuer: string) => Promise<SessionMode> | SessionMode);

  /**
   * Configuration for detecting the AI platform from MCP client info.
   * Allows custom mappings to override or supplement the default keyword-based detection.
   */
  platformDetection?: PlatformDetectionConfigInterface;
}
