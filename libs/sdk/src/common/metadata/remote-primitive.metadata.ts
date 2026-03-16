/**
 * @file remote-primitive.metadata.ts
 * @description Base option types for `.esm()` and `.remote()` static methods
 * on primitive decorators (Tool, Resource, Prompt, Agent, Skill, Job) and App.
 */

import type { PackageLoader, RemoteTransportOptions, RemoteAuthConfig } from './app.metadata';

/**
 * Base ESM loading options shared by all `.esm()` methods (primitives and apps).
 *
 * @typeParam M - Metadata type for the primitive (e.g., `ToolMetadata`, `ResourceMetadata`).
 *   When provided, allows overriding the loaded primitive's metadata via `metadata`.
 */
export interface EsmOptions<M = Record<string, unknown>> {
  /** Per-primitive loader override (registry URL, auth token) */
  loader?: PackageLoader;
  /** Cache TTL in milliseconds */
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
