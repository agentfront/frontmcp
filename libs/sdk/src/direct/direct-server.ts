/**
 * DirectMcpServerImpl - Implementation of DirectMcpServer
 *
 * Provides programmatic access to FrontMCP servers by bypassing the HTTP transport
 * layer and invoking flows directly on the Scope instance.
 */

import { randomUUID } from '@frontmcp/utils';
import type {
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListPromptsResult,
  GetPromptResult,
  ListResourceTemplatesResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { DirectMcpServer, DirectCallOptions, DirectAuthContext } from './direct.types';
import type { Scope } from '../scope/scope.instance';
import { FlowControl } from '../common';
import { InternalMcpError } from '../errors';

/**
 * Build AuthInfo from DirectAuthContext for flow execution.
 * Returns Partial<AuthInfo> since direct calls may not have full auth context.
 */
function buildAuthInfo(authContext?: DirectAuthContext, defaultSessionId?: string): Partial<AuthInfo> | undefined {
  if (!authContext && !defaultSessionId) {
    return undefined;
  }

  // Build minimal auth info - flows handle missing fields gracefully
  const sessionId = authContext?.sessionId ?? defaultSessionId ?? `direct:${randomUUID()}`;
  const token = authContext?.token ?? '';
  const user = authContext?.user ? { sub: authContext.user.sub ?? 'direct', ...authContext.user } : { sub: 'direct' };

  // Cast via unknown to bypass strict type checking - flows handle missing fields gracefully
  return {
    token,
    sessionId,
    user,
    scopes: [],
    clientId: user.sub ?? 'direct',
    extra: authContext?.extra,
  } as unknown as Partial<AuthInfo>;
}

/**
 * Implementation of DirectMcpServer that bypasses HTTP transport
 * and invokes flows directly on a Scope instance.
 */
export class DirectMcpServerImpl implements DirectMcpServer {
  private readonly scope: Scope;
  readonly ready: Promise<void>;
  private _isDisposed = false;
  private readonly defaultSessionId: string;

  constructor(scope: Scope) {
    this.scope = scope;
    this.defaultSessionId = `direct:${randomUUID()}`;
    this.ready = Promise.resolve(); // Scope is already initialized
  }

  /**
   * Build the MCP handler context that flows expect.
   * This simulates what the transport layer creates from HTTP request.
   */
  private buildHandlerContext(options?: DirectCallOptions): { authInfo?: Partial<AuthInfo> } {
    const authInfo = buildAuthInfo(options?.authContext, this.defaultSessionId);
    return { authInfo };
  }

  /**
   * Run a flow and handle FlowControl exceptions.
   */
  private async runFlow<T>(
    flowName: string,
    request: { method: string; params?: unknown },
    options?: DirectCallOptions,
  ): Promise<T> {
    if (this._isDisposed) {
      throw new InternalMcpError('DirectMcpServer has been disposed');
    }

    const ctx = this.buildHandlerContext(options);

    try {
      // All MCP operations go through the standard flow system
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await this.scope.runFlowForOutput(flowName as any, { request, ctx });
    } catch (e) {
      // FlowControl is a control flow mechanism, not an error
      if (e instanceof FlowControl) {
        if (e.type === 'respond') {
          return e.output as T;
        }
        // For other flow control types, throw an error
        throw new InternalMcpError(`Flow ended with: ${e.type}`);
      }
      throw e;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Tool Operations
  // ─────────────────────────────────────────────────────────────────

  async listTools(options?: DirectCallOptions): Promise<ListToolsResult> {
    return this.runFlow<ListToolsResult>('tools:list-tools', { method: 'tools/list', params: {} }, options);
  }

  async callTool(name: string, args?: Record<string, unknown>, options?: DirectCallOptions): Promise<CallToolResult> {
    return this.runFlow<CallToolResult>(
      'tools:call-tool',
      { method: 'tools/call', params: { name, arguments: args ?? {} } },
      options,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Resource Operations
  // ─────────────────────────────────────────────────────────────────

  async listResources(options?: DirectCallOptions): Promise<ListResourcesResult> {
    return this.runFlow<ListResourcesResult>(
      'resources:list-resources',
      { method: 'resources/list', params: {} },
      options,
    );
  }

  async listResourceTemplates(options?: DirectCallOptions): Promise<ListResourceTemplatesResult> {
    return this.runFlow<ListResourceTemplatesResult>(
      'resources:list-resource-templates',
      { method: 'resources/templates/list', params: {} },
      options,
    );
  }

  async readResource(uri: string, options?: DirectCallOptions): Promise<ReadResourceResult> {
    return this.runFlow<ReadResourceResult>(
      'resources:read-resource',
      { method: 'resources/read', params: { uri } },
      options,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Prompt Operations
  // ─────────────────────────────────────────────────────────────────

  async listPrompts(options?: DirectCallOptions): Promise<ListPromptsResult> {
    return this.runFlow<ListPromptsResult>('prompts:list-prompts', { method: 'prompts/list', params: {} }, options);
  }

  async getPrompt(name: string, args?: Record<string, string>, options?: DirectCallOptions): Promise<GetPromptResult> {
    return this.runFlow<GetPromptResult>(
      'prompts:get-prompt',
      { method: 'prompts/get', params: { name, arguments: args } },
      options,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;

    // Cleanup transport service if exists
    if (this.scope.transportService) {
      try {
        await this.scope.transportService.destroy();
      } catch (err) {
        // Log but don't throw - cleanup should be best-effort
        console.debug('DirectMcpServer cleanup warning:', err);
      }
    }
  }
}
