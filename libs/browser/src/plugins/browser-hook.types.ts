// file: libs/browser/src/plugins/browser-hook.types.ts
/**
 * Browser-specific hook stages for MCP request lifecycle.
 *
 * These are simpler than SDK's full flow system, focusing on the
 * key interception points in the browser MCP server.
 */

import type { BrowserMcpServer } from '../server/browser-server';
import type { McpStore } from '../store';

/**
 * Hook stages for browser MCP server.
 */
export type BrowserHookStage =
  // Request lifecycle
  | 'willHandle' // Before any request processing
  | 'didHandle' // After response sent

  // Tool lifecycle
  | 'willListTools' // Before tools/list
  | 'didListTools' // After tools/list (can filter results)
  | 'willCallTool' // Before tools/call
  | 'didCallTool' // After tools/call

  // Resource lifecycle
  | 'willListResources' // Before resources/list
  | 'didListResources' // After resources/list
  | 'willReadResource' // Before resources/read
  | 'didReadResource' // After resources/read

  // Prompt lifecycle
  | 'willListPrompts' // Before prompts/list
  | 'didListPrompts' // After prompts/list
  | 'willGetPrompt' // Before prompts/get
  | 'didGetPrompt' // After prompts/get

  // Error handling
  | 'onError'; // On any error

/**
 * Control flow actions for hooks.
 */
export type HookFlowAction =
  | { type: 'continue' }
  | { type: 'respond'; result: unknown }
  | { type: 'abort'; error: Error };

/**
 * Context passed to hook functions.
 */
export interface BrowserHookContext<TParams = unknown, TResult = unknown> {
  /** The hook stage being executed */
  readonly stage: BrowserHookStage;

  /** The MCP method being called */
  readonly method: string;

  /** The request parameters */
  readonly params: TParams;

  /** The result (available in 'did*' hooks) */
  result?: TResult;

  /** Error if one occurred (available in 'onError' hook) */
  error?: Error;

  /** Arbitrary metadata for passing data between hooks */
  metadata: Record<string, unknown>;

  /** Reference to the server */
  readonly server: BrowserMcpServer;

  /** Reference to the store (if configured) */
  readonly store?: McpStore<object>;

  /** Internal flow action - set by respond/abort */
  _flowAction: HookFlowAction;

  /**
   * Stop hook chain and respond immediately with a result.
   * Useful for caching, short-circuiting, etc.
   */
  respond(result: TResult): void;

  /**
   * Stop hook chain with an error.
   * The error will be returned to the client.
   */
  abort(error: Error): void;
}

/**
 * A hook function that intercepts a stage.
 */
export type BrowserHook<TParams = unknown, TResult = unknown> = (
  ctx: BrowserHookContext<TParams, TResult>,
) => void | Promise<void>;

/**
 * Hook registration with priority.
 */
export interface BrowserHookRegistration<TParams = unknown, TResult = unknown> {
  /** The stage this hook runs at */
  stage: BrowserHookStage;

  /** The hook function */
  hook: BrowserHook<TParams, TResult>;

  /** Priority (higher = runs first for 'will*', last for 'did*') */
  priority: number;

  /** Plugin name that registered this hook */
  pluginName: string;
}

/**
 * Typed hook definitions for plugins.
 */
export interface BrowserPluginHooks {
  // Request lifecycle
  willHandle?: BrowserHook;
  didHandle?: BrowserHook;

  // Tool lifecycle
  willListTools?: BrowserHook<undefined, { tools: Array<{ name: string; description: string; inputSchema: unknown }> }>;
  didListTools?: BrowserHook<undefined, { tools: Array<{ name: string; description: string; inputSchema: unknown }> }>;
  willCallTool?: BrowserHook<{ name: string; arguments?: Record<string, unknown> }>;
  didCallTool?: BrowserHook<
    { name: string; arguments?: Record<string, unknown> },
    { content: unknown[]; isError?: boolean }
  >;

  // Resource lifecycle
  willListResources?: BrowserHook<undefined, { resources: Array<{ uri: string; name: string }> }>;
  didListResources?: BrowserHook<undefined, { resources: Array<{ uri: string; name: string }> }>;
  willReadResource?: BrowserHook<{ uri: string }>;
  didReadResource?: BrowserHook<{ uri: string }, { contents: unknown[] }>;

  // Prompt lifecycle
  willListPrompts?: BrowserHook<undefined, { prompts: Array<{ name: string }> }>;
  didListPrompts?: BrowserHook<undefined, { prompts: Array<{ name: string }> }>;
  willGetPrompt?: BrowserHook<{ name: string; arguments?: Record<string, string> }>;
  didGetPrompt?: BrowserHook<{ name: string; arguments?: Record<string, string> }, { messages: unknown[] }>;

  // Error handling
  onError?: BrowserHook<unknown, { error: Error }>;
}

/**
 * Creates a hook context with control flow methods.
 */
export function createHookContext<TParams, TResult>(
  stage: BrowserHookStage,
  method: string,
  params: TParams,
  server: BrowserMcpServer,
  store?: McpStore<object>,
  result?: TResult,
  error?: Error,
): BrowserHookContext<TParams, TResult> {
  const ctx: BrowserHookContext<TParams, TResult> = {
    stage,
    method,
    params,
    result,
    error,
    metadata: {},
    server,
    store,
    _flowAction: { type: 'continue' },

    respond(res: TResult) {
      ctx._flowAction = { type: 'respond', result: res };
    },

    abort(err: Error) {
      ctx._flowAction = { type: 'abort', error: err };
    },
  };

  return ctx;
}
