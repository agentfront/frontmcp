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
import type { DirectMcpServer, DirectCallOptions, DirectAuthContext, DirectRequestMetadata } from './direct.types';
import type { ConnectOptions } from './client.types';
import type { DirectClient } from './client.types';
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
  // UserClaim requires both 'iss' (issuer) and 'sub' (subject)
  const user = authContext?.user
    ? { iss: 'direct', sub: authContext.user.sub ?? 'direct', ...authContext.user }
    : { iss: 'direct', sub: 'direct' };
  const clientId = user.sub ?? 'direct';

  // Build auth info object, only including token if provided
  const authInfo: Partial<AuthInfo> = {
    sessionId,
    user,
    scopes: [],
    clientId,
    extra: authContext?.extra,
  };

  // Only add token if explicitly provided (don't coerce to empty string)
  if (authContext?.token !== undefined) {
    authInfo.token = authContext.token;
  }

  return authInfo;
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
  private buildHandlerContext(options?: DirectCallOptions): {
    authInfo?: Partial<AuthInfo>;
    metadata?: DirectRequestMetadata;
  } {
    const authInfo = buildAuthInfo(options?.authContext, this.defaultSessionId);
    return {
      authInfo,
      metadata: options?.metadata,
    };
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
      // Cast required: flowName is a string but runFlowForOutput expects specific flow type union.
      // The flow names used here are all valid MCP flow names from the SDK.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await this.scope.runFlowForOutput(flowName as any, { request, ctx });
    } catch (e) {
      // FlowControl is a control flow mechanism, not an error
      if (e instanceof FlowControl) {
        if (e.type === 'respond') {
          return e.output as T;
        }
        // For other flow control types (fail, abort), include details in error
        const details = e.output ? `: ${JSON.stringify(e.output)}` : '';
        throw new InternalMcpError(`Flow ended with ${e.type}${details}`);
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
  // Job Operations - delegate to MCP tools
  // ─────────────────────────────────────────────────────────────────

  async listJobs(options?: DirectCallOptions): Promise<CallToolResult> {
    return this.callTool('list-jobs', {}, options);
  }

  async executeJob(
    name: string,
    input?: Record<string, unknown>,
    options?: DirectCallOptions & { background?: boolean },
  ): Promise<CallToolResult> {
    return this.callTool(
      'execute-job',
      { name, input: input ?? {}, background: options?.background ?? false },
      options,
    );
  }

  async getJobStatus(runId: string, options?: DirectCallOptions): Promise<CallToolResult> {
    return this.callTool('get-job-status', { runId }, options);
  }

  // ─────────────────────────────────────────────────────────────────
  // Workflow Operations - delegate to MCP tools
  // ─────────────────────────────────────────────────────────────────

  async listWorkflows(options?: DirectCallOptions): Promise<CallToolResult> {
    return this.callTool('list-workflows', {}, options);
  }

  async executeWorkflow(
    name: string,
    input?: Record<string, unknown>,
    options?: DirectCallOptions & { background?: boolean },
  ): Promise<CallToolResult> {
    return this.callTool(
      'execute-workflow',
      { name, input: input ?? {}, background: options?.background ?? false },
      options,
    );
  }

  async getWorkflowStatus(runId: string, options?: DirectCallOptions): Promise<CallToolResult> {
    return this.callTool('get-workflow-status', { runId }, options);
  }

  // ─────────────────────────────────────────────────────────────────
  // Client Connections
  // ─────────────────────────────────────────────────────────────────

  async connect(sessionIdOrOptions?: string | ConnectOptions): Promise<DirectClient> {
    if (this._isDisposed) {
      throw new InternalMcpError('DirectMcpServer has been disposed');
    }

    const options: ConnectOptions | undefined =
      typeof sessionIdOrOptions === 'string' ? { session: { id: sessionIdOrOptions } } : sessionIdOrOptions;

    const { DirectClientImpl } = await import('./direct-client.js');
    return DirectClientImpl.create(this.scope, options);
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
