/**
 * @file proxy-prompt.entry.ts
 * @description Prompt entry that proxies gets to a remote MCP server
 */

import type { Prompt, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import {
  PromptEntry,
  PromptContext,
  PromptCtorArgs,
  PromptGetExtra,
  PromptMetadata,
  EntryOwnerRef,
  ParsedPromptResult,
  PromptSafeTransformResult,
} from '../../common';
import type { McpClientService } from '../mcp-client.service';
import type { McpRemoteAuthContext } from '../mcp-client.types';
import { PromptKind, PromptRecord } from '../../common/records/prompt.record';
import ProviderRegistry from '../../provider/provider.registry';
import { Scope } from '../../scope';
import HookRegistry from '../../hooks/hook.registry';

// ═══════════════════════════════════════════════════════════════════
// PROXY PROMPT RECORD
// ═══════════════════════════════════════════════════════════════════

/**
 * Record type for proxy prompts
 */
export interface ProxyPromptRecord {
  kind: 'PROXY';
  provide: typeof ProxyPromptContext;
  metadata: PromptMetadata;
  remotePrompt: Prompt;
  remoteAppId: string;
  mcpClient: McpClientService;
}

// ═══════════════════════════════════════════════════════════════════
// PROXY PROMPT CONTEXT
// ═══════════════════════════════════════════════════════════════════

/**
 * Prompt context that proxies gets to a remote MCP server.
 */
export class ProxyPromptContext extends PromptContext {
  private readonly mcpClient: McpClientService;
  private readonly remoteAppId: string;
  private readonly remotePromptName: string;

  constructor(args: PromptCtorArgs, mcpClient: McpClientService, remoteAppId: string, remotePromptName: string) {
    super(args);
    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
    this.remotePromptName = remotePromptName;
  }

  /**
   * Execute the prompt get by proxying to the remote MCP server
   */
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    // Build auth context from gateway auth info
    const authContext: McpRemoteAuthContext = {
      authInfo: this.authInfo,
    };

    // Get from the remote server
    const result = await this.mcpClient.getPrompt(this.remoteAppId, this.remotePromptName, args, authContext);

    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROXY PROMPT ENTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * Prompt entry that wraps a remote prompt and proxies gets to the remote server.
 */
export class ProxyPromptEntry extends PromptEntry {
  /** The MCP client service for remote communication */
  private readonly mcpClient: McpClientService;

  /** The remote app this prompt belongs to */
  private readonly remoteAppId: string;

  /** The original remote prompt definition */
  private readonly remotePrompt: Prompt;

  /** The provider registry this prompt is bound to */
  private readonly providers: ProviderRegistry;

  /** The scope this prompt operates in */
  readonly scope: Scope;

  /** The hook registry for this prompt's scope */
  readonly hooks: HookRegistry;

  constructor(
    remotePrompt: Prompt,
    mcpClient: McpClientService,
    remoteAppId: string,
    providers: ProviderRegistry,
    owner: EntryOwnerRef,
    namespace?: string,
  ) {
    const record = createProxyPromptRecord(remotePrompt, remoteAppId, mcpClient, namespace);
    super(record as unknown as PromptRecord);

    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
    this.remotePrompt = remotePrompt;
    this.providers = providers;
    this.owner = owner;

    // Set name with optional namespace prefix
    const promptName = remotePrompt.name;
    this.name = namespace ? `${namespace}:${promptName}` : promptName;
    this.fullName = `${owner.id}:${this.name}`;

    // Set scope and hooks
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    // Initialize
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Get the remote prompt definition
   */
  getRemotePrompt(): Prompt {
    return this.remotePrompt;
  }

  /**
   * Get the remote app ID
   */
  getRemoteAppId(): string {
    return this.remoteAppId;
  }

  /**
   * Create a proxy prompt context for execution
   */
  override create(args: Record<string, string>, ctx: PromptGetExtra): PromptContext {
    const metadata = this.metadata;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const promptCtorArgs: PromptCtorArgs = {
      metadata,
      args,
      providers: this.providers,
      logger,
      authInfo,
    };

    return new ProxyPromptContext(promptCtorArgs, this.mcpClient, this.remoteAppId, this.remotePrompt.name);
  }

  /**
   * Parse and validate arguments against the prompt's argument definitions
   */
  override parseArguments(args?: Record<string, string>): Record<string, string> {
    const parsedArgs: Record<string, string> = {};
    const remoteArgs = this.remotePrompt.arguments || [];

    for (const argDef of remoteArgs) {
      const value = args?.[argDef.name];
      if (argDef.required && (value === undefined || value === null)) {
        throw new Error(`Missing required argument: ${argDef.name}`);
      }
      if (value !== undefined && value !== null) {
        parsedArgs[argDef.name] = value;
      }
    }

    return parsedArgs;
  }

  /**
   * Parse output from the remote prompt result
   */
  override parseOutput(raw: unknown): ParsedPromptResult {
    // If already a GetPromptResult, return it
    if (this.isGetPromptResult(raw)) {
      return raw;
    }

    // Otherwise, wrap it in a user message
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: typeof raw === 'string' ? raw : JSON.stringify(raw),
          },
        },
      ],
    };
  }

  /**
   * Safely parse output from the remote prompt result
   */
  override safeParseOutput(raw: unknown): PromptSafeTransformResult<ParsedPromptResult> {
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
   * Check if a value is a GetPromptResult
   */
  private isGetPromptResult(value: unknown): value is GetPromptResult {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj['messages']);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a synthetic prompt record from a remote prompt definition
 */
function createProxyPromptRecord(
  remotePrompt: Prompt,
  remoteAppId: string,
  mcpClient: McpClientService,
  namespace?: string,
): ProxyPromptRecord {
  const promptName = namespace ? `${namespace}:${remotePrompt.name}` : remotePrompt.name;

  const metadata: PromptMetadata = {
    name: promptName,
    description: remotePrompt.description || `Proxy to remote prompt: ${remotePrompt.name}`,
    arguments:
      remotePrompt.arguments?.map((arg) => ({
        name: arg.name,
        description: arg.description,
        required: arg.required,
      })) || [],
  };

  return {
    kind: 'PROXY',
    provide: ProxyPromptContext,
    metadata,
    remotePrompt,
    remoteAppId,
    mcpClient,
  };
}

/**
 * Create a ProxyPromptEntry from a remote prompt definition
 */
export function createProxyPromptEntry(
  remotePrompt: Prompt,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ProxyPromptEntry {
  return new ProxyPromptEntry(remotePrompt, mcpClient, remoteAppId, providers, owner, namespace);
}
