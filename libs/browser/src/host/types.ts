// file: libs/browser/src/host/types.ts
/**
 * Type definitions for the App Bridge / Host SDK.
 */

// =============================================================================
// MCP Types (simplified for host/child communication)
// =============================================================================

/**
 * Server implementation info (name and version).
 */
export interface ServerInfo {
  name: string;
  version: string;
}

/**
 * Content item for resources and prompts.
 */
export interface ContentItem {
  type: 'text' | 'image' | 'resource';
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
}

/**
 * Result from reading a resource.
 */
export interface ReadResourceResult {
  contents: ContentItem[];
}

/**
 * Result from getting a prompt.
 */
export interface GetPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: ContentItem | ContentItem[];
  }>;
}

// =============================================================================
// Sandbox Permissions
// =============================================================================

export type SandboxPermission =
  | 'allow-scripts'
  | 'allow-forms'
  | 'allow-same-origin'
  | 'allow-popups'
  | 'allow-modals'
  | 'allow-downloads'
  | 'allow-pointer-lock'
  | 'allow-orientation-lock'
  | 'allow-presentation'
  | 'allow-top-navigation'
  | 'allow-top-navigation-by-user-activation'
  | 'allow-storage-access-by-user-activation';

// =============================================================================
// Authentication Context
// =============================================================================

export interface AuthContext {
  token?: string;
  userId?: string;
  permissions?: string[];
  sessionId?: string;
  claims?: Record<string, unknown>;
}

// =============================================================================
// Human-in-the-Loop Configuration
// =============================================================================

export interface HiTLConfig {
  alwaysConfirm?: string[];
  confirmationTimeout?: number;
  timeoutBehavior?: 'allow' | 'deny';
  onConfirmationRequired?: (action: string, args: unknown) => Promise<boolean>;
}

// =============================================================================
// App Host Options
// =============================================================================

export interface AppHostOptions {
  container: HTMLElement;
  sandbox?: SandboxPermission[];
  allowedOrigins?: string[];
  style?: Partial<CSSStyleDeclaration>;
  connectionTimeout?: number;
  hitl?: HiTLConfig;
  authContext?: AuthContext;
  onError?: (error: AppHostError) => void;
}

// =============================================================================
// App Load Configuration
// =============================================================================

export interface AppLoadConfig {
  src: string;
  id?: string;
  name?: string;
  sandbox?: SandboxPermission[];
  width?: number | string;
  height?: number | string;
  attributes?: Record<string, string>;
  initialData?: unknown;
  autoConnect?: boolean;
}

// =============================================================================
// Loaded App State
// =============================================================================

export type LoadedAppState = 'loading' | 'ready' | 'connected' | 'error' | 'disconnected';

// =============================================================================
// Loaded App Interface
// =============================================================================

export interface LoadedApp {
  readonly id: string;
  readonly name: string;
  readonly iframe: HTMLIFrameElement;
  readonly state: LoadedAppState;
  readonly serverInfo?: ServerInfo;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  callTool<T>(name: string, args: unknown): Promise<T>;
  readResource(uri: string): Promise<ReadResourceResult>;
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
  postMessage(type: string, payload: unknown): void;
  onMessage(handler: (type: string, payload: unknown) => void): () => void;
}

// =============================================================================
// App Host Interface
// =============================================================================

export type AppHostEvent = 'app:loaded' | 'app:ready' | 'app:connected' | 'app:error' | 'app:disconnected';
export type AppEventHandler = (app: LoadedApp, data?: unknown) => void;

export interface AppHost {
  load(config: AppLoadConfig): Promise<LoadedApp>;
  unload(appId: string): Promise<void>;
  unloadAll(): Promise<void>;
  get(appId: string): LoadedApp | undefined;
  list(): LoadedApp[];
  on(event: AppHostEvent, handler: AppEventHandler): () => void;
  updateAuthContext(context: Partial<AuthContext>): void;
  destroy(): Promise<void>;
}

// =============================================================================
// App Child Options
// =============================================================================

export interface AppChildOptions {
  allowedOrigins?: string[];
  onInitialData?: (data: unknown) => void;
  onError?: (error: AppChildError) => void;
}

// =============================================================================
// App Child Interface
// =============================================================================

export interface AppChild {
  ready(): void;
  getInitialData<T>(): T | undefined;
  postMessage(type: string, payload: unknown): void;
  onMessage(handler: (type: string, payload: unknown) => void): () => void;
  requestPermission(permission: string): Promise<boolean>;
  getPermissions(): string[];
}

// =============================================================================
// Error Classes
// =============================================================================

export class AppHostError extends Error {
  constructor(message: string, public readonly appId?: string) {
    super(message);
    this.name = 'AppHostError';
  }
}

export class AppLoadError extends AppHostError {
  constructor(message: string, public readonly src: string) {
    super(message);
    this.name = 'AppLoadError';
  }
}

export class AppConnectionError extends AppHostError {
  constructor(message: string, appId: string) {
    super(message, appId);
    this.name = 'AppConnectionError';
  }
}

export class AppTimeoutError extends AppHostError {
  constructor(message: string, appId: string) {
    super(message, appId);
    this.name = 'AppTimeoutError';
  }
}

export class OriginNotAllowedError extends AppHostError {
  constructor(public readonly origin: string) {
    super(`Origin not allowed: ${origin}`);
    this.name = 'OriginNotAllowedError';
  }
}

export class AppChildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppChildError';
  }
}

// =============================================================================
// Message Types
// =============================================================================

export type HostMessage =
  | { type: 'mcp:request'; id: string; method: string; params?: unknown }
  | { type: 'app:init'; data?: unknown; auth?: AuthContext }
  | { type: 'app:focus' }
  | { type: 'app:blur' }
  | { type: 'auth:refresh'; token?: string }
  | { type: 'custom'; payload: unknown };

export type ChildMessage =
  | { type: 'mcp:response'; id: string; result?: unknown; error?: unknown }
  | { type: 'mcp:notification'; method: string; params?: unknown }
  | { type: 'app:ready'; serverInfo?: ServerInfo }
  | { type: 'app:resize'; width: number; height: number }
  | { type: 'app:error'; error: string }
  | { type: 'custom'; payload: unknown };
