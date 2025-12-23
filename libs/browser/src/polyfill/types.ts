// file: libs/browser/src/polyfill/types.ts
/**
 * Type definitions for the navigator.modelContext API.
 *
 * This implements a W3C-aligned polyfill for browser-native MCP access.
 */

import type { ReadResourceResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// =============================================================================
// JSON Schema Types
// =============================================================================

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JSONSchema;
}

// =============================================================================
// Server Info
// =============================================================================

export interface ServerInfo {
  name: string;
  version: string;
  description?: string;
}

export interface ClientInfo {
  name: string;
  version: string;
}

// =============================================================================
// Transport Configuration
// =============================================================================

export interface TransportConfig {
  type: 'event' | 'postMessage' | 'custom';
  target?: Window | Worker | MessagePort;
  options?: Record<string, unknown>;
}

// =============================================================================
// Capabilities
// =============================================================================

export interface ModelContextCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
}

// =============================================================================
// Connect Options
// =============================================================================

export interface ConnectOptions {
  serverInfo: ServerInfo;
  transport?: TransportConfig;
  capabilities?: ModelContextCapabilities;
  timeout?: number;
}

// =============================================================================
// Tool Definition
// =============================================================================

export interface ToolMeta {
  resourceUri?: string;
  uiHint?: 'form' | 'modal' | 'inline' | 'panel';
  confirmRequired?: boolean;
}

export interface ToolDefinition<In = unknown, Out = unknown> {
  description: string;
  inputSchema: JSONSchema | { _def?: unknown }; // Zod schema or JSON Schema
  outputSchema?: JSONSchema | { _def?: unknown };
  execute: (args: In) => Promise<Out> | Out;
  _meta?: ToolMeta;
}

// =============================================================================
// Resource Definition
// =============================================================================

export interface ResourceDefinition<Params extends Record<string, string> = Record<string, string>> {
  name: string;
  description?: string;
  mimeType?: string;
  read: (params: Params) => Promise<ReadResourceResult> | ReadResourceResult;
  subscribe?: (params: Params, callback: () => void) => () => void;
}

// =============================================================================
// Prompt Definition
// =============================================================================

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptDefinition {
  name?: string;
  description?: string;
  arguments?: PromptArgument[];
  execute: (args: Record<string, string>) => Promise<GetPromptResult> | GetPromptResult;
}

// =============================================================================
// Session Types
// =============================================================================

export type SessionState = 'connecting' | 'connected' | 'disconnected';

export type SessionEventType = 'disconnect' | 'error' | 'toolCall';

export interface ModelContextSession {
  readonly clientInfo: ClientInfo | null;
  readonly state: SessionState;

  registerTool<In = unknown, Out = unknown>(name: string, definition: ToolDefinition<In, Out>): () => void;

  registerResource<Params extends Record<string, string> = Record<string, string>>(
    uri: string,
    definition: ResourceDefinition<Params>,
  ): () => void;

  registerPrompt(name: string, definition: PromptDefinition): () => void;

  unregisterTool(name: string): void;
  unregisterResource(uri: string): void;
  unregisterPrompt(name: string): void;

  notify(method: string, params?: unknown): void;

  close(): Promise<void>;

  on(event: SessionEventType, handler: (...args: unknown[]) => void): () => void;
}

// =============================================================================
// Navigator Extension
// =============================================================================

export interface NavigatorModelContext {
  connect(options: ConnectOptions): Promise<ModelContextSession>;
  readonly supported: boolean;
  readonly polyfillVersion?: string;
}

// =============================================================================
// Error Classes
// =============================================================================

export class ModelContextConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelContextConnectionError';
  }
}

export class ModelContextTimeoutError extends Error {
  constructor(message: string = 'Connection timed out') {
    super(message);
    this.name = 'ModelContextTimeoutError';
  }
}

export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRegistrationError';
  }
}

export class ResourceRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceRegistrationError';
  }
}

export class PromptRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptRegistrationError';
  }
}

// =============================================================================
// Global Declaration
// =============================================================================

declare global {
  interface Navigator {
    readonly modelContext?: NavigatorModelContext;
  }
}
