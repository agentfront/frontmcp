/**
 * @file proxy-resource.entry.ts
 * @description Resource entry that proxies reads to a remote MCP server
 */

import type { Resource, ResourceTemplate, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ResourceEntry,
  ResourceContext,
  ResourceCtorArgs,
  ResourceReadExtra,
  ResourceMetadata,
  ResourceTemplateMetadata,
  EntryOwnerRef,
  ParsedResourceResult,
  ResourceSafeTransformResult,
} from '../../common';
import type { McpClientService } from '../mcp-client.service';
import type { McpRemoteAuthContext } from '../mcp-client.types';
import { AnyResourceRecord, ResourceKind } from '../../common/records/resource.record';
import ProviderRegistry from '../../provider/provider.registry';
import { Scope } from '../../scope';
import HookRegistry from '../../hooks/hook.registry';

// ═══════════════════════════════════════════════════════════════════
// PROXY RESOURCE RECORD
// ═══════════════════════════════════════════════════════════════════

/**
 * Record type for proxy resources
 */
export interface ProxyResourceRecord {
  kind: 'PROXY';
  provide: typeof ProxyResourceContext;
  metadata: ResourceMetadata | ResourceTemplateMetadata;
  remoteResource: Resource | ResourceTemplate;
  remoteAppId: string;
  mcpClient: McpClientService;
  isTemplate: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PROXY RESOURCE CONTEXT
// ═══════════════════════════════════════════════════════════════════

/**
 * Resource context that proxies reads to a remote MCP server.
 */
export class ProxyResourceContext<
  Params extends Record<string, string> = Record<string, string>,
  Out = ReadResourceResult,
> extends ResourceContext<Params, Out> {
  private readonly mcpClient: McpClientService;
  private readonly remoteAppId: string;

  constructor(args: ResourceCtorArgs<Params>, mcpClient: McpClientService, remoteAppId: string) {
    super(args);
    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
  }

  /**
   * Execute the resource read by proxying to the remote MCP server
   */
  async execute(uri: string, _params: Params): Promise<Out> {
    // Build auth context from gateway auth info
    const authContext: McpRemoteAuthContext = {
      authInfo: this.authInfo,
    };

    // Read from the remote server
    const result = await this.mcpClient.readResource(this.remoteAppId, uri, authContext);

    return result as Out;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROXY RESOURCE ENTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * Resource entry that wraps a remote resource and proxies reads to the remote server.
 */
export class ProxyResourceEntry<
  Params extends Record<string, string> = Record<string, string>,
  Out = ReadResourceResult,
> extends ResourceEntry<Params, Out> {
  /** The MCP client service for remote communication */
  private readonly mcpClient: McpClientService;

  /** The remote app this resource belongs to */
  private readonly remoteAppId: string;

  /** The original remote resource definition */
  private readonly remoteResource: Resource | ResourceTemplate;

  /** The provider registry this resource is bound to */
  private readonly providers: ProviderRegistry;

  /** The scope this resource operates in */
  readonly scope: Scope;

  /** The hook registry for this resource's scope */
  readonly hooks: HookRegistry;

  /** Compiled URI template pattern for matching */
  private readonly uriPattern?: RegExp;

  /** Parameter names extracted from the URI template */
  private readonly paramNames: string[];

  constructor(
    remoteResource: Resource | ResourceTemplate,
    mcpClient: McpClientService,
    remoteAppId: string,
    providers: ProviderRegistry,
    owner: EntryOwnerRef,
    namespace?: string,
  ) {
    // Determine if this is a template or static resource
    const isTemplate = 'uriTemplate' in remoteResource;
    const record = createProxyResourceRecord(remoteResource, remoteAppId, mcpClient, isTemplate, namespace);
    super(record as unknown as AnyResourceRecord);

    this.mcpClient = mcpClient;
    this.remoteAppId = remoteAppId;
    this.remoteResource = remoteResource;
    this.providers = providers;
    this.owner = owner;
    this.isTemplate = isTemplate;

    // Set name with optional namespace prefix
    const resourceName = remoteResource.name;
    this.name = namespace ? `${namespace}:${resourceName}` : resourceName;
    this.fullName = `${owner.id}:${this.name}`;

    // Set URI or URI template
    if (isTemplate) {
      this.uriTemplate = (remoteResource as ResourceTemplate).uriTemplate;
      const { pattern, paramNames } = this.compileUriTemplate(this.uriTemplate);
      this.uriPattern = pattern;
      this.paramNames = paramNames;
    } else {
      this.uri = (remoteResource as Resource).uri;
      this.paramNames = [];
    }

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
   * Get the remote resource definition
   */
  getRemoteResource(): Resource | ResourceTemplate {
    return this.remoteResource;
  }

  /**
   * Get the remote app ID
   */
  getRemoteAppId(): string {
    return this.remoteAppId;
  }

  /**
   * Create a proxy resource context for execution
   */
  override create(uri: string, params: Params, ctx: ResourceReadExtra): ResourceContext<Params, Out> {
    const metadata = this.metadata;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const resourceCtorArgs: ResourceCtorArgs<Params> = {
      metadata,
      uri,
      params,
      providers: this.providers,
      logger,
      authInfo,
    };

    return new ProxyResourceContext<Params, Out>(resourceCtorArgs, this.mcpClient, this.remoteAppId);
  }

  /**
   * Match a URI against this resource
   */
  override matchUri(uri: string): { matches: boolean; params: Params } {
    if (this.isTemplate) {
      return this.matchTemplateUri(uri);
    } else {
      return {
        matches: uri === this.uri,
        params: {} as Params,
      };
    }
  }

  /**
   * Parse output from the remote resource result
   */
  override parseOutput(raw: Out): ParsedResourceResult {
    // If already a ReadResourceResult, return it
    if (this.isReadResourceResult(raw)) {
      return raw;
    }

    // Otherwise, wrap it in a text content
    return {
      contents: [
        {
          uri: this.uri || '',
          mimeType: 'text/plain',
          text: typeof raw === 'string' ? raw : JSON.stringify(raw),
        },
      ],
    };
  }

  /**
   * Safely parse output from the remote resource result
   */
  override safeParseOutput(raw: Out): ResourceSafeTransformResult<ParsedResourceResult> {
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
   * Compile a URI template into a regex pattern
   */
  private compileUriTemplate(template: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexStr = template.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    return {
      pattern: new RegExp(`^${regexStr}$`),
      paramNames,
    };
  }

  /**
   * Match a URI against the template pattern
   */
  private matchTemplateUri(uri: string): { matches: boolean; params: Params } {
    if (!this.uriPattern) {
      return { matches: false, params: {} as Params };
    }

    const match = uri.match(this.uriPattern);
    if (!match) {
      return { matches: false, params: {} as Params };
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < this.paramNames.length; i++) {
      params[this.paramNames[i]] = match[i + 1];
    }

    return { matches: true, params: params as Params };
  }

  /**
   * Check if a value is a ReadResourceResult
   */
  private isReadResourceResult(value: unknown): value is ReadResourceResult {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return Array.isArray(obj['contents']);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a synthetic resource record from a remote resource definition
 */
function createProxyResourceRecord(
  remoteResource: Resource | ResourceTemplate,
  remoteAppId: string,
  mcpClient: McpClientService,
  isTemplate: boolean,
  namespace?: string,
): ProxyResourceRecord {
  const resourceName = namespace ? `${namespace}:${remoteResource.name}` : remoteResource.name;

  const baseMetadata = {
    name: resourceName,
    description: remoteResource.description || `Proxy to remote resource: ${remoteResource.name}`,
    mimeType: remoteResource.mimeType,
    annotations: {
      ...(remoteResource.annotations || {}),
      'frontmcp:proxy': true,
      'frontmcp:remoteAppId': remoteAppId,
      'frontmcp:remoteResource': remoteResource.name,
    },
  };

  const metadata: ResourceMetadata | ResourceTemplateMetadata = isTemplate
    ? {
        ...baseMetadata,
        uriTemplate: (remoteResource as ResourceTemplate).uriTemplate,
      }
    : {
        ...baseMetadata,
        uri: (remoteResource as Resource).uri,
      };

  return {
    kind: 'PROXY',
    provide: ProxyResourceContext,
    metadata,
    remoteResource,
    remoteAppId,
    mcpClient,
    isTemplate,
  };
}

/**
 * Create a ProxyResourceEntry from a remote resource definition
 */
export function createProxyResourceEntry(
  remoteResource: Resource | ResourceTemplate,
  mcpClient: McpClientService,
  remoteAppId: string,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ProxyResourceEntry {
  return new ProxyResourceEntry(remoteResource, mcpClient, remoteAppId, providers, owner, namespace);
}
