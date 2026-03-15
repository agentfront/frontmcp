/**
 * Core types for @frontmcp/react
 */

import type React from 'react';
import type { DirectMcpServer, DirectClient, CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import type { ComponentRegistry } from './components/ComponentRegistry';
import type { DynamicRegistry } from './registry/DynamicRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Tool / Resource / Prompt info types (from MCP protocol)
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplateInfo {
  uriTemplate: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider status
// ─────────────────────────────────────────────────────────────────────────────

export type FrontMcpStatus = 'idle' | 'connecting' | 'connected' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Provider context value (internal — slim, carries only name + registry + connect)
// ─────────────────────────────────────────────────────────────────────────────

export interface FrontMcpContextValue {
  name: string;
  registry: ComponentRegistry;
  dynamicRegistry: DynamicRegistry;
  getDynamicRegistry: (server?: string) => DynamicRegistry;
  connect: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic tool / resource definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface DynamicToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export interface DynamicResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  read: () => Promise<ReadResourceResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolved server (public return type of useFrontMcp)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedServer {
  name: string;
  server: DirectMcpServer | null;
  client: DirectClient | null;
  status: FrontMcpStatus;
  error: Error | null;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  resourceTemplates: ResourceTemplateInfo[];
  prompts: PromptInfo[];
  registry: ComponentRegistry;
  connect: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook state types
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  called: boolean;
}

export interface ResourceState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export interface PromptState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook return types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseCallToolOptions {
  resetOnToolChange?: boolean;
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  /** Target a specific named server from the ServerRegistry */
  server?: string;
}

export type UseCallToolReturn<TInput extends object, TOutput> = [
  (args: TInput) => Promise<TOutput | null>,
  ToolState<TOutput>,
  () => void,
];

// ─────────────────────────────────────────────────────────────────────────────
// Component rendering types
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentNode {
  type: string;
  props?: Record<string, unknown>;
  children?: string | ComponentNode | ComponentNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Form field rendering
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldRenderProps {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  value: string;
  onChange: (value: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store adapter (provider-level state integration)
// ─────────────────────────────────────────────────────────────────────────────

export interface StoreAdapter {
  /** Logical name for this store (e.g., 'redux', 'valtio'). */
  name: string;
  /** Returns the current state snapshot. */
  getState: () => unknown;
  /** Subscribes to state changes. Returns an unsubscribe function. */
  subscribe: (cb: () => void) => () => void;
  /** Named selectors — each becomes a sub-resource state://{name}/{key}. */
  selectors?: Record<string, (state: unknown) => unknown>;
  /** Named actions — each becomes a dynamic tool {name}_{key}. */
  actions?: Record<string, (...args: unknown[]) => unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// mcpComponent column definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface McpColumnDef<T = unknown> {
  key: string;
  header: string;
  render?: (value: T) => React.ReactNode;
}
