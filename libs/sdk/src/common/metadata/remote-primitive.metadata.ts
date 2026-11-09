/**
 * @file remote-primitive.metadata.ts
 * @description Base option types for `.esm()` and `.remote()` static methods
 * on primitive decorators (Tool, Resource, Prompt, Agent, Skill, Job) and App.
 */

import type { PackageLoader, RemoteAuthConfig, RemoteTransportOptions } from './app.metadata';

/**
 * Base ESM loading options shared by all `.esm()` methods (primitives and apps).
 *
 * @typeParam M - Metadata type for the primitive (e.g., `ToolMetadata`, `ResourceMetadata`).
 *   When provided, allows overriding the loaded primitive's metadata via `metadata`.
 */
export interface EsmOptions<M = Record<string, unknown>> {
  /**
   * Loader for this entry: the fields it sets replace the server's `loader` fields, the rest come from the server's.
   * A `token` or `tokenEnvVar` here replaces both of the server's.
   */
  loader?: PackageLoader;
  /** Milliseconds a downloaded bundle is reused (default: 86400000 = 24 hours); `0` downloads it on every load */
  cacheTTL?: number;
  /** Override or extend the loaded primitive's metadata (e.g., name, description) */
  metadata?: Partial<M>;
}

/**
 * Base remote options shared by all `.remote()` methods (primitives and apps).
 *
 * @typeParam M - Metadata type for the primitive (e.g., `ToolMetadata`, `ResourceMetadata`).
 *   When provided, allows overriding the proxied primitive's metadata via `metadata`.
 */
export interface RemoteOptions<M = Record<string, unknown>> {
  /** Transport-specific options (timeout, retries, headers) */
  transportOptions?: RemoteTransportOptions;
  /** Authentication config for the remote server */
  remoteAuth?: RemoteAuthConfig;
  /** Override or extend the proxied primitive's metadata (e.g., name, description) */
  metadata?: Partial<M>;
}
