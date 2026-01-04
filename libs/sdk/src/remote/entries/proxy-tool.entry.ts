/**
 * @file proxy-tool.entry.ts
 * @description Tool entry that proxies execution to a remote MCP server
 */

import type { Tool, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  ToolEntry,
  ToolContext,
  ToolCallArgs,
  ToolCallExtra,
  ToolCtorArgs,
  ToolMetadata,
  ToolInputType,
  ToolOutputType,
  EntryOwnerRef,
  ParsedToolResult,
  SafeTransformResult,
} from '../../common';
import type { McpClientService } from '../mcp-client.service';
import type { McpRemoteAuthContext } from '../mcp-client.types';
import { ToolKind, ToolRecord } from '../../common/records/tool.record';
import ProviderRegistry from '../../provider/provider.registry';
import { Scope } from '../../scope';
import HookRegistry from '../../hooks/hook.registry';

// ═══════════════════════════════════════════════════════════════════
// PROXY TOOL RECORD
// ═══════════════════════════════════════════════════════════════════

/**
 * Record type for proxy tools
 */
export interface ProxyToolRecord {
  kind: 'PROXY';
  provide: typeof ProxyToolContext;
  metadata: ToolMetadata;
  remoteTool: Tool;
  remoteAppId: string;
  mcpClient: McpClientService;
}

// ═══════════════════════════════════════════════════════════════════
// PROXY TOOL CONTEXT
// ═══════════════════════════════════════════════════════════════════

/**
 * Tool context that proxies execution to a remote MCP server.
 *
 * This context:
 * - Forwards input to the remote server
 * - Passes auth context for authentication
 * - Returns the remote server's response
 */
export class ProxyToolContext<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = Record<string, unknown>,
  Out = CallToolResult,
> extends ToolContext<InSchema, OutSchema, In, Out> {
  private readonly mcpClient: McpClientService;
  private readonly remoteAppId: string;
  private readonly remoteToolName: string;

  constructor(args: ToolCtorArgs<In>, mcpClient: McpClientService, remoteAppId: string, remoteToolName: string) {
    super(args);
    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
    this.remoteToolName = remoteToolName;
  }

  /**
   * Execute the tool by proxying to the remote MCP server
   */
  async execute(input: In): Promise<Out> {
    // Build auth context from gateway auth info
    const authContext: McpRemoteAuthContext = {
      authInfo: this.authInfo,
    };

    // Call the remote tool
    const result = await this.mcpClient.callTool(
      this.remoteAppId,
      this.remoteToolName,
      input as Record<string, unknown>,
      authContext,
    );

    // The result IS the output for proxy tools
    return result as Out;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROXY TOOL ENTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * Tool entry that wraps a remote tool and proxies execution to the remote server.
 *
 * This entry:
 * - Exposes the remote tool's metadata to the gateway
 * - Creates ProxyToolContext for execution
 * - Handles input/output parsing using the remote tool's schema
 * - Integrates with gateway hooks (cache, auth, audit)
 */
export class ProxyToolEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = Record<string, unknown>,
  Out = CallToolResult,
> extends ToolEntry<InSchema, OutSchema, In, Out> {
  /** The MCP client service for remote communication */
  private readonly mcpClient: McpClientService;

  /** The remote app this tool belongs to */
  private readonly remoteAppId: string;

  /** The original remote tool definition */
  private readonly remoteTool: Tool;

  /** The provider registry this tool is bound to */
  private readonly providers: ProviderRegistry;

  /** The scope this tool operates in */
  readonly scope: Scope;

  /** The hook registry for this tool's scope */
  readonly hooks: HookRegistry;

  constructor(
    remoteTool: Tool,
    mcpClient: McpClientService,
    remoteAppId: string,
    providers: ProviderRegistry,
    owner: EntryOwnerRef,
    namespace?: string,
  ) {
    // Create a synthetic record for this proxy tool
    const record = createProxyToolRecord(remoteTool, remoteAppId, mcpClient, namespace);
    super(record as unknown as ToolRecord);

    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
    this.remoteTool = remoteTool;
    this.providers = providers;
    this.owner = owner;

    // Set name with optional namespace prefix
    const toolName = remoteTool.name;
    this.name = namespace ? `${namespace}:${toolName}` : toolName;
    this.fullName = `${owner.id}:${this.name}`;

    // Set scope and hooks
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    // Parse input schema from remote tool
    this.inputSchema = this.parseRemoteInputSchema(remoteTool.inputSchema) as unknown as InSchema;
    this.rawInputSchema = remoteTool.inputSchema;

    // Output schema is 'json' for MCP tools (CallToolResult)
    this.outputSchema = 'json' as OutSchema;

    // Initialize (no async work needed for proxy tools)
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    // Proxy tools don't have embedded hooks to register
    // All hook integration happens through the normal flow
    return Promise.resolve();
  }

  /**
   * Get the remote tool definition
   */
  getRemoteTool(): Tool {
    return this.remoteTool;
  }

  /**
   * Get the remote app ID
   */
  getRemoteAppId(): string {
    return this.remoteAppId;
  }

  /**
   * Create a proxy tool context for execution
   */
  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const toolCtorArgs: ToolCtorArgs<In> = {
      metadata,
      input: input as In,
      providers: this.providers,
      logger,
      authInfo,
    };

    return new ProxyToolContext<InSchema, OutSchema, In, Out>(
      toolCtorArgs,
      this.mcpClient,
      this.remoteAppId,
      this.remoteTool.name,
    );
  }

  /**
   * Parse input using the remote tool's input schema
   */
  override parseInput(input: CallToolRequest['params']): CallToolRequest['params']['arguments'] {
    // Use the parsed input schema if available
    if (this.inputSchema && Object.keys(this.inputSchema).length > 0) {
      const inputSchemaObj = z.object(this.inputSchema);
      return inputSchemaObj.parse(input.arguments);
    }

    // Otherwise, pass through the arguments
    return input.arguments || {};
  }

  /**
   * Parse output from the remote tool result
   *
   * For proxy tools, the output is already a CallToolResult from the remote server,
   * so we just pass it through.
   */
  override parseOutput(raw: Out | Partial<Out> | unknown): ParsedToolResult {
    // If the raw result is already a CallToolResult, return it
    if (this.isCallToolResult(raw)) {
      return raw;
    }

    // Otherwise, wrap it in a text content block
    return {
      content: [
        {
          type: 'text',
          text: typeof raw === 'string' ? raw : JSON.stringify(raw),
        },
      ],
    };
  }

  /**
   * Safely parse output from the remote tool result
   */
  override safeParseOutput(raw: Out | Partial<Out> | unknown): SafeTransformResult<ParsedToolResult> {
    try {
      return { success: true, data: this.parseOutput(raw) };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Convert remote input schema (JSON Schema) to Zod schema shape
   */
  private parseRemoteInputSchema(inputSchema: Tool['inputSchema']): Record<string, z.ZodTypeAny> {
    if (!inputSchema) {
      return {};
    }

    const properties = (inputSchema as Record<string, unknown>)['properties'] as Record<string, unknown> | undefined;
    const required = ((inputSchema as Record<string, unknown>)['required'] as string[]) || [];

    if (!properties) {
      return {};
    }

    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, propSchema] of Object.entries(properties)) {
      const prop = propSchema as Record<string, unknown>;
      const isRequired = required.includes(key);

      let zodType: z.ZodTypeAny;

      // Convert JSON Schema type to Zod type
      const propType = prop['type'] as string | undefined;
      const propEnum = prop['enum'] as string[] | undefined;

      switch (propType) {
        case 'string':
          zodType = z.string();
          if (propEnum) {
            zodType = z.enum(propEnum as [string, ...string[]]);
          }
          break;
        case 'number':
        case 'integer':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.unknown());
          break;
        case 'object':
          zodType = z.record(z.string(), z.unknown());
          break;
        default:
          zodType = z.unknown();
      }

      // Make optional if not required
      if (!isRequired) {
        zodType = zodType.optional();
      }

      shape[key] = zodType;
    }

    return shape;
  }

  /**
   * Check if a value is a CallToolResult
   */
  private isCallToolResult(value: unknown): value is CallToolResult {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj['content']);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a synthetic tool record from a remote tool definition
 */
function createProxyToolRecord(
  remoteTool: Tool,
  remoteAppId: string,
  mcpClient: McpClientService,
  namespace?: string,
): ProxyToolRecord {
  const toolName = namespace ? `${namespace}:${remoteTool.name}` : remoteTool.name;

  const metadata: ToolMetadata = {
    name: toolName,
    id: toolName,
    description: remoteTool.description || `Proxy to remote tool: ${remoteTool.name}`,
    inputSchema: {},
    rawInputSchema: remoteTool.inputSchema as ToolMetadata['rawInputSchema'],
    outputSchema: 'json' as ToolMetadata['outputSchema'],
    annotations: {
      ...remoteTool.annotations,
      // Mark as proxy tool for identification
      'frontmcp:proxy': true,
      'frontmcp:remoteAppId': remoteAppId,
      'frontmcp:remoteTool': remoteTool.name,
    },
  };

  return {
    kind: 'PROXY',
    provide: ProxyToolContext,
    metadata,
    remoteTool,
    remoteAppId,
    mcpClient,
  };
}

/**
 * Create a ProxyToolEntry from a remote tool definition
 */
export function createProxyToolEntry(
  remoteTool: Tool,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ProxyToolEntry {
  return new ProxyToolEntry(remoteTool, mcpClient, remoteAppId, providers, owner, namespace);
}
