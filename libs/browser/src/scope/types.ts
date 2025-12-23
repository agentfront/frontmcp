// file: libs/browser/src/scope/types.ts
/**
 * Types for Browser Scope
 *
 * Note: These types are prefixed with "Scope" to avoid conflicts with
 * the more specific definitions in the server module.
 */

import type { ToolMetadata, ResourceMetadata, PromptMetadata } from '@frontmcp/sdk/core';
import type { BrowserTransport } from '../transport/transport.interface';
import type { PlatformCrypto, PlatformStorage, PlatformLogger } from '../platform';

/**
 * Server info for browser scope
 */
export interface BrowserServerInfo {
  name: string;
  version: string;
  description?: string;
}

/**
 * Options for creating a browser scope
 */
export interface BrowserScopeOptions {
  /** Server information */
  serverInfo: BrowserServerInfo;

  /** Transport adapter for MCP communication */
  transport?: BrowserTransport;

  /** Custom crypto adapter (uses Web Crypto by default) */
  crypto?: PlatformCrypto;

  /** Custom storage adapter (uses localStorage by default) */
  storage?: PlatformStorage;

  /** Custom logger (uses console by default) */
  logger?: PlatformLogger;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Tool definition for scope registration (simplified)
 */
export interface ScopeToolDefinition<In = unknown, Out = unknown> {
  /** Unique tool name */
  name: string;

  /** Tool description */
  description: string;

  /** Input schema (Zod or JSON Schema) */
  inputSchema?: unknown;

  /** Output schema (Zod or JSON Schema) */
  outputSchema?: unknown;

  /** Tool handler */
  handler: (input: In) => Promise<Out> | Out;

  /** Additional metadata */
  metadata?: Partial<ToolMetadata>;
}

/**
 * Resource definition for scope registration (simplified)
 */
export interface ScopeResourceDefinition<T = unknown> {
  /** Unique resource URI */
  uri: string;

  /** Resource name */
  name: string;

  /** Resource description */
  description?: string;

  /** MIME type */
  mimeType?: string;

  /** Resource read handler */
  handler: () => Promise<T> | T;

  /** Additional metadata */
  metadata?: Partial<ResourceMetadata>;
}

/**
 * Prompt definition for scope registration (simplified)
 */
export interface ScopePromptDefinition {
  /** Unique prompt name */
  name: string;

  /** Prompt description */
  description: string;

  /** Prompt arguments */
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;

  /** Prompt handler */
  handler: (args: Record<string, string>) => Promise<string> | string;

  /** Additional metadata */
  metadata?: Partial<PromptMetadata>;
}

/**
 * Tool change event
 */
export interface BrowserToolChangeEvent {
  kind: 'added' | 'removed' | 'reset';
  toolName: string;
}

/**
 * Resource change event
 */
export interface BrowserResourceChangeEvent {
  kind: 'added' | 'removed' | 'reset';
  resourceUri: string;
}

/**
 * Browser scope capabilities
 */
export interface BrowserScopeCapabilities {
  tools: {
    listChanged: boolean;
  };
  resources: {
    subscribe: boolean;
    listChanged: boolean;
  };
  prompts: {
    listChanged: boolean;
  };
}
