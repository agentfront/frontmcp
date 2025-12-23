// file: libs/browser/src/react/context/context.ts
/**
 * React context types and creation for FrontMCP browser integration.
 */

import { createContext, useContext } from 'react';
import type { BrowserMcpServer } from '../../server';
import type { BrowserScope } from '../../scope';
import type { McpStore } from '../../store';
import type { ComponentRegistry, RendererRegistry } from '../../registry';
import type { BrowserTransport } from '../../transport';

/**
 * BrowserStore is an alias for McpStore.
 */
export type BrowserStore<T extends object = object> = McpStore<T>;

/**
 * Page element registration for AI discovery.
 */
export interface PageElement {
  id: string;
  type: 'form' | 'button' | 'input' | 'table' | 'list' | 'dialog' | 'custom';
  name: string;
  description?: string;
  fields?: string[];
  actions?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Elicit request types for human-in-the-loop interactions.
 */
export type ElicitRequestType = 'confirm' | 'select' | 'input' | 'form';

/**
 * Elicit request from AI agent.
 */
export interface ElicitRequest {
  id: string;
  type: ElicitRequestType;
  message: string;
  options?: string[];
  schema?: Record<string, unknown>;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Elicit response from user.
 */
export interface ElicitResponse {
  requestId: string;
  response: unknown;
  dismissed?: boolean;
}

/**
 * Notification event for agent communication.
 */
export interface NotificationEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

/**
 * FrontMCP React context value.
 */
export interface FrontMcpContextValue<TState extends object = object> {
  /**
   * The browser MCP server instance.
   * @deprecated Use `scope` instead for SDK-based integration.
   */
  server: BrowserMcpServer | null;

  /**
   * The browser scope instance (SDK-based).
   * Provides tool, resource, and prompt registration with SDK features.
   */
  scope: BrowserScope | null;

  /**
   * The reactive store instance.
   */
  store: BrowserStore<TState> | null;

  /**
   * The transport adapter.
   */
  transport: BrowserTransport | null;

  /**
   * The component registry.
   */
  componentRegistry: ComponentRegistry | null;

  /**
   * The renderer registry.
   */
  rendererRegistry: RendererRegistry | null;

  /**
   * Whether the server is connected and ready.
   */
  isConnected: boolean;

  /**
   * Whether the server is currently starting/connecting.
   */
  isConnecting: boolean;

  /**
   * Connection error, if any.
   */
  error: Error | null;

  /**
   * Registered page elements for AI discovery.
   */
  pageElements: Map<string, PageElement>;

  /**
   * Register a page element.
   */
  registerPageElement: (element: Omit<PageElement, 'id'>) => string;

  /**
   * Unregister a page element.
   */
  unregisterPageElement: (id: string) => void;

  /**
   * Send a notification to the AI agent.
   */
  notifyAgent: (type: string, data: unknown) => void;

  /**
   * Pending elicit request from AI.
   */
  pendingElicitRequest: ElicitRequest | null;

  /**
   * Respond to an elicit request.
   */
  respondToElicit: (response: unknown) => void;

  /**
   * Dismiss an elicit request.
   */
  dismissElicit: () => void;

  /**
   * Call a tool by name.
   */
  callTool: <TInput = unknown, TOutput = unknown>(name: string, args: TInput) => Promise<TOutput>;

  /**
   * Read a resource by URI.
   */
  readResource: (uri: string) => Promise<unknown>;

  /**
   * List all available tools.
   */
  listTools: () => { name: string; description?: string }[];

  /**
   * List all available resources.
   */
  listResources: () => { uri: string; name?: string; description?: string }[];
}

/**
 * Default context value (not connected).
 */
const defaultContextValue: FrontMcpContextValue = {
  server: null,
  scope: null,
  store: null,
  transport: null,
  componentRegistry: null,
  rendererRegistry: null,
  isConnected: false,
  isConnecting: false,
  error: null,
  pageElements: new Map(),
  registerPageElement: () => {
    throw new Error('FrontMcpProvider not found');
  },
  unregisterPageElement: () => {
    throw new Error('FrontMcpProvider not found');
  },
  notifyAgent: () => {
    throw new Error('FrontMcpProvider not found');
  },
  pendingElicitRequest: null,
  respondToElicit: () => {
    throw new Error('FrontMcpProvider not found');
  },
  dismissElicit: () => {
    throw new Error('FrontMcpProvider not found');
  },
  callTool: () => {
    throw new Error('FrontMcpProvider not found');
  },
  readResource: () => {
    throw new Error('FrontMcpProvider not found');
  },
  listTools: () => [],
  listResources: () => [],
};

/**
 * FrontMCP React context.
 */
export const FrontMcpContext = createContext<FrontMcpContextValue>(defaultContextValue);

/**
 * Hook to access the FrontMCP context.
 * @throws Error if used outside of FrontMcpProvider
 */
export function useFrontMcpContext<TState extends object = object>(): FrontMcpContextValue<TState> {
  const context = useContext(FrontMcpContext);
  if (context === defaultContextValue) {
    throw new Error('useFrontMcpContext must be used within a FrontMcpProvider');
  }
  return context as FrontMcpContextValue<TState>;
}
