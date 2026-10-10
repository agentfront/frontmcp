// common/types/options/session/interfaces.ts
// Explicit TypeScript interfaces for session configuration

import { type AIPlatformType } from '../../auth/session.types';

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
   * Custom mappings, checked first: a match wins over the MCP Apps capability and over the
   * keyword detection, so a mapping can opt a client that declares MCP Apps out of it.
   * Mappings are evaluated in order; first match wins.
   */
  mappings?: PlatformMappingEntryInterface[];
  /**
   * If true, skip default detection when no custom mapping matches.
   * The platform will be 'unknown' instead of attempting keyword-based detection
   * (a client that declares the MCP Apps extension is still 'ext-apps').
   * @default false
   */
  customOnly?: boolean;
}

/**
 * The pre-1.0 session options: the shape of the old `@FrontMcp({ session })` option, replaced by
 * `transport` in v1.0.
 *
 * @deprecated Nothing reads these options. Whether the server keeps sessions follows
 * `transport.protocol` (`'stateless-api'` serves without them), and platform detection is
 * `transport.platformDetection`. A server config that still sets `session` is accepted and ignored,
 * with a startup warning. Removed in the next major.
 */
export interface SessionOptionsInterface {
  /**
   * @deprecated Ignored — nothing reads it — and removed in the next major. Use `transport.protocol`:
   * whether the server keeps sessions follows it (`'stateless-api'` serves without them).
   *
   * It once chose where nested provider tokens were kept: `'stateless'` embedded them in the JWT.
   * That no longer happens whatever this says: FrontMCP never embeds provider tokens in the tokens it
   * issues, and the ones it keeps stay server-side in `auth.tokenStorage` (memory, SQLite or Redis).
   * A server config that still sets `session.sessionMode` to anything but `'stateful'` gets a startup
   * warning.
   */
  sessionMode?: SessionMode | ((issuer: string) => Promise<SessionMode> | SessionMode);

  /**
   * @deprecated Ignored here; set `transport.platformDetection` instead. A server config that still
   * sets `session.platformDetection` gets a startup warning. Removed in the next major.
   */
  platformDetection?: PlatformDetectionConfigInterface;
}
