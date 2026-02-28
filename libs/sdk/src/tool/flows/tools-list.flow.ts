// tools/flows/list-tools.flow.ts
import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, ToolEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { ListToolsRequestSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError, InternalMcpError } from '../../errors';
import { hasUIConfig } from '../ui';
// TODO: Re-implement against new @frontmcp/uipack API after redesign
// import { buildCDNInfoForUIType, type UIType } from '@frontmcp/uipack/build';
// import { isUIType } from '@frontmcp/uipack/types';
// import type { AIPlatformType } from '@frontmcp/uipack/adapters';
type UIType = string;
type AIPlatformType = string;
function buildCDNInfoForUIType(..._args: unknown[]): Record<string, unknown> {
  return {};
}
function isUIType(_value: unknown): _value is UIType {
  return typeof _value === 'string';
}
import type { Scope } from '../../scope/scope.instance';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { ToolPaginationOptions } from '../../common/types/options/pagination';
import { DEFAULT_TOOL_PAGINATION } from '../../common/types/options/pagination';

const inputSchema = z.object({
  request: ListToolsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListToolsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  // z.any() used because AuthInfo is an external type from @modelcontextprotocol/sdk that varies by SDK version
  // Non-optional for 'authorized' flows - transport layer ensures authInfo is always present
  authInfo: z.any() as z.ZodType<AuthInfo>,
  platformType: z.string().optional() as z.ZodType<AIPlatformType | undefined>,
  tools: z.array(
    z.object({
      appName: z.string(),
      tool: z.instanceof(ToolEntry),
    }),
  ),
  resolvedTools: z.array(
    z.object({
      appName: z.string(),
      tool: z.instanceof(ToolEntry),
      finalName: z.string(),
    }),
  ),
});

/** Base response tool item from MCP SDK */
type BaseResponseToolItem = z.infer<typeof outputSchema>['tools'][number];

/** Extended response tool item that includes outputSchema (MCP spec supports this) */
type ResponseToolItem = BaseResponseToolItem & {
  outputSchema?: Record<string, unknown>;
};

// TODO: add support for session based tools
const plan = {
  pre: ['parseInput', 'ensureRemoteCapabilities'],
  execute: ['findTools', 'resolveConflicts'],
  post: ['parseTools'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tools:list-tools': FlowRunOptions<
      ToolsListFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tools:list-tools' as const;
const { Stage } = FlowHooksOf('tools:list-tools');

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ToolsListFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ToolsListFlow');

  private sample<T>(arr: T[], n = 5): T[] {
    return arr.slice(0, n);
  }

  /**
   * Determine if pagination should be applied based on tool count and config.
   */
  private shouldPaginate(toolCount: number, config?: ToolPaginationOptions): boolean {
    // No config means use auto mode
    if (!config) {
      // Auto mode: paginate only if toolCount exceeds default threshold
      return toolCount > DEFAULT_TOOL_PAGINATION.autoThreshold;
    }

    const mode = config.mode ?? 'auto';

    // Explicit false disables pagination
    if (mode === false) return false;

    // Explicit true always enables pagination
    if (mode === true) return true;

    // 'auto' mode: paginate if tool count exceeds threshold
    const threshold = config.autoThreshold ?? DEFAULT_TOOL_PAGINATION.autoThreshold;
    return toolCount > threshold;
  }

  /**
   * Parse a cursor string to extract the offset.
   * Cursor format: Base64-encoded JSON { offset: number }
   *
   * @throws InvalidInputError if cursor is malformed or contains invalid offset
   */
  private parseCursor(cursor: string): number {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      const offset = parsed?.offset;

      if (typeof offset !== 'number' || offset < 0 || !Number.isInteger(offset)) {
        throw new InvalidInputError(
          `Invalid pagination cursor: offset must be a non-negative integer, got ${
            typeof offset === 'number' ? offset : typeof offset
          }`,
        );
      }

      return offset;
    } catch (e) {
      if (e instanceof InvalidInputError) throw e;
      throw new InvalidInputError(
        `Invalid pagination cursor format. Expected base64-encoded JSON with 'offset' field.`,
      );
    }
  }

  /**
   * Encode an offset into a cursor string.
   */
  private encodeCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset })).toString('base64');
  }

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: any;
    let ctx: { authInfo?: AuthInfo } | undefined;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx as { authInfo?: AuthInfo } | undefined;
    } catch (e) {
      throw new InvalidInputError('Invalid request format', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'tools/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'tools/list');
    }

    // Extract authInfo - required for 'authorized' flows (transport layer ensures it's present)
    const authInfo = ctx?.authInfo;
    if (!authInfo) {
      throw new InternalMcpError(
        'AuthInfo missing in tools/list for authorized flow - this should never happen',
        'AUTH_INFO_MISSING',
      );
    }

    const sessionId = authInfo.sessionId;

    // Cast scope to access notifications service for platform detection
    const scope = this.scope as Scope;

    // Get platform type: first check sessionIdPayload (detected from user-agent),
    // then fall back to notification service (detected from MCP clientInfo),
    // finally default to 'unknown'
    const platformType: AIPlatformType =
      authInfo.sessionIdPayload?.platformType ??
      (sessionId ? scope.notifications?.getPlatformType(sessionId) : undefined) ??
      'unknown';

    this.logger.verbose(`parseInput: detected platform=${platformType}`);

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set({ cursor, authInfo, platformType });
    this.logger.verbose('parseInput:done');
  }

  /**
   * Ensure remote app capabilities are loaded before listing tools.
   * Remote apps use lazy capability discovery - this triggers the loading.
   * Uses provider registry to find all remote apps across all app registries.
   */
  @Stage('ensureRemoteCapabilities')
  async ensureRemoteCapabilities() {
    this.logger.verbose('ensureRemoteCapabilities:start');

    // Get all apps from all app registries (same approach as ToolRegistry.initialize)
    // This finds remote apps that may be in parent scopes
    const appRegistries = this.scope.providers.getRegistries('AppRegistry');
    const remoteApps: Array<{ id: string; ensureCapabilitiesLoaded?: () => Promise<void> }> = [];

    for (const appRegistry of appRegistries) {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        if (app.isRemote) {
          remoteApps.push(app);
        }
      }
    }

    this.logger.verbose(
      `ensureRemoteCapabilities: found ${remoteApps.length} remote app(s) across ${appRegistries.length} registries`,
    );

    if (remoteApps.length === 0) {
      this.logger.verbose('ensureRemoteCapabilities:skip (no remote apps)');
      return;
    }

    // Trigger capability loading for all remote apps in parallel
    const loadPromises = remoteApps.map(async (app) => {
      // Check if app has ensureCapabilitiesLoaded method (remote apps do)
      if ('ensureCapabilitiesLoaded' in app && typeof app.ensureCapabilitiesLoaded === 'function') {
        try {
          await app.ensureCapabilitiesLoaded();
        } catch (error) {
          this.logger.warn(`Failed to load capabilities for remote app ${app.id}: ${(error as Error).message}`);
        }
      }
    });

    await Promise.all(loadPromises);
    this.logger.verbose('ensureRemoteCapabilities:done');
  }

  @Stage('findTools')
  async findTools() {
    this.logger.info('findTools:start');

    try {
      // Check for skills-only mode - return empty tools array
      const { authInfo } = this.state.required;
      if (authInfo.sessionIdPayload?.skillsOnlyMode) {
        this.logger.info('findTools: skills-only mode - returning empty tools array');
        this.state.set('tools', []);
        this.logger.verbose('findTools:done (skills-only mode)');
        return;
      }

      const apps = this.scope.apps.getApps();
      this.logger.info(`findTools: discovered ${apps.length} app(s)`);

      const tools: Array<{ appName: string; tool: ToolEntry }> = [];
      const seenToolIds = new Set<string>();

      // Get elicitation support from session payload (set during MCP initialize)
      // authInfo is guaranteed by parseInput (throws if missing for authorized flow)
      const supportsElicitation = authInfo.sessionIdPayload?.supportsElicitation;

      // Get tools appropriate for this client's elicitation support
      const scopeTools = this.scope.tools.getToolsForListing(supportsElicitation);
      this.logger.verbose(`findTools: scope tools=${scopeTools.length}`);

      for (const tool of scopeTools) {
        // Deduplicate tools by owner + name combination
        // This prevents the same tool from being registered twice while allowing
        // different owners to have tools with the same name (for conflict resolution)
        const toolId = `${tool.owner.id}:${tool.fullName || tool.metadata.id || tool.metadata.name}`;
        if (!seenToolIds.has(toolId)) {
          seenToolIds.add(toolId);
          tools.push({ appName: tool.owner.id, tool });
        }
      }

      this.logger.info(`findTools: total tools collected=${tools.length}`);
      if (tools.length === 0) {
        this.logger.warn('findTools: no tools found across apps');
      }

      this.state.set('tools', tools);
      this.logger.verbose('findTools:done');
    } catch (error) {
      this.logger.error('findTools: failed to collect tools', error);
      throw error;
    }
  }

  @Stage('resolveConflicts')
  async resolveConflicts() {
    this.logger.verbose('resolveConflicts:start');

    try {
      const found = this.state.required.tools;

      const counts = new Map<string, number>();
      for (const { tool } of found) {
        const baseName = tool.metadata.id ?? tool.metadata.name;
        counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
      }

      const conflicts = new Set<string>([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));

      if (conflicts.size > 0) {
        const preview = this.sample(Array.from(conflicts)).join(', ');
        const extra = conflicts.size > 5 ? `, +${conflicts.size - 5} more` : '';
        this.logger.warn(`resolveConflicts: ${conflicts.size} name conflict(s) detected: ${preview}${extra}`);
      } else {
        this.logger.info('resolveConflicts: no name conflicts detected');
      }

      const resolved = found.map(({ appName, tool }) => {
        const baseName = tool.metadata.id ?? tool.metadata.name;
        const finalName = conflicts.has(baseName) ? `${appName}:${baseName}` : baseName;
        return { appName, tool, finalName };
      });

      this.state.set('resolvedTools', resolved);
      this.logger.verbose('resolveConflicts:done');
    } catch (error) {
      this.logger.error('resolveConflicts: failed to resolve conflicts', error);
      throw error;
    }
  }

  @Stage('parseTools')
  async parseTools() {
    this.logger.verbose('parseTools:start');

    try {
      const allResolved = this.state.required.resolvedTools;
      const platformType = this.state.platformType ?? 'unknown';

      // Get pagination config from scope
      const scope = this.scope as Scope;
      const paginationConfig = scope.pagination?.tools;

      // Determine if pagination should apply
      const usePagination = this.shouldPaginate(allResolved.length, paginationConfig);

      // Sort tools by finalName for stable ordering across pagination requests.
      // This ensures cursor-based pagination returns consistent results.
      const sortedResolved = [...allResolved].sort((a, b) => a.finalName.localeCompare(b.finalName));

      // Calculate page boundaries
      let resolved = sortedResolved;
      let nextCursor: string | undefined;

      if (usePagination) {
        const cursor = this.state.cursor;
        const offset = cursor ? this.parseCursor(cursor) : 0;
        const pageSize = paginationConfig?.pageSize ?? DEFAULT_TOOL_PAGINATION.pageSize;

        // Validate offset is within bounds
        if (offset > sortedResolved.length) {
          throw new InvalidInputError(
            `Invalid pagination cursor: offset ${offset} exceeds total tool count ${sortedResolved.length}`,
          );
        }

        // Slice to current page
        resolved = sortedResolved.slice(offset, offset + pageSize);

        // Generate nextCursor if more tools remain
        const nextOffset = offset + pageSize;
        if (nextOffset < sortedResolved.length) {
          nextCursor = this.encodeCursor(nextOffset);
        }

        this.logger.verbose(
          `parseTools: pagination active - offset=${offset}, pageSize=${pageSize}, ` +
            `returning ${resolved.length}/${sortedResolved.length} tools` +
            (nextCursor ? `, nextCursor=${nextCursor}` : ''),
        );
      }

      // Only OpenAI ChatGPT uses openai/* meta keys
      // ext-apps (SEP-1865) uses ui/* keys per the MCP Apps specification
      const isOpenAIPlatform = platformType === 'openai';

      const tools: ResponseToolItem[] = resolved.map(({ finalName, tool }) => {
        // Get the input schema - prefer rawInputSchema (JSON Schema), then convert from tool.inputSchema
        let inputSchema: any;
        if (tool.rawInputSchema) {
          // Already converted to JSON Schema
          inputSchema = tool.rawInputSchema;
        } else if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
          // tool.inputSchema is a ZodRawShape (extracted .shape from ZodObject in ToolInstance constructor)
          // Convert to JSON Schema
          try {
            // as any used here to prevent hard ts-check on tool input that is redundant
            // and just slow down the build process. types here are unnecessary.
            inputSchema = toJSONSchema(z.object(tool.inputSchema));
          } catch (e) {
            this.logger.warn(`Failed to convert inputSchema for tool ${finalName}:`, e);
            inputSchema = { type: 'object', properties: {} };
          }
        } else {
          // No schema defined - use empty object schema
          inputSchema = { type: 'object', properties: {} };
        }

        const item: ResponseToolItem = {
          name: finalName,
          title: tool.metadata.name,
          description: tool.metadata.description,
          annotations: tool.metadata.annotations,
          inputSchema,
        };

        // Add outputSchema if available (from OpenAPI tools or explicit rawOutputSchema)
        // Note: When elicitation is enabled, getRawOutputSchema() transparently extends
        // the schema to include the elicitation fallback response type
        const outputSchema = tool.getRawOutputSchema();
        if (outputSchema) {
          item.outputSchema = outputSchema as typeof item.outputSchema;
        }

        // Add _meta for tools with UI configuration
        // OpenAI platforms use openai/* keys, other platforms use ui/* keys only
        if (hasUIConfig(tool.metadata)) {
          const uiConfig = tool.metadata.ui;
          if (!uiConfig) {
            // This should never happen if hasUIConfig returned true
            return item;
          }

          // Get manifest info from registry (if available)
          // Type guard: verify scope has toolUI with required methods before accessing
          const isValidScope = (obj: unknown): obj is Scope => {
            return (
              obj !== null &&
              typeof obj === 'object' &&
              'toolUI' in obj &&
              typeof (obj as { toolUI?: unknown }).toolUI === 'object' &&
              (obj as { toolUI?: unknown }).toolUI !== null &&
              typeof (obj as { toolUI: { getManifest?: unknown } }).toolUI.getManifest === 'function' &&
              typeof (obj as { toolUI: { detectUIType?: unknown } }).toolUI.detectUIType === 'function'
            );
          };

          if (!isValidScope(this.scope)) {
            this.logger.warn(`parseTools: toolUI not available in scope for ${finalName}`);
            return item;
          }
          const scope = this.scope;

          // Get manifest and detect UI type with error handling
          let manifest;
          let detectedType: string;
          try {
            manifest = scope.toolUI.getManifest(finalName);
            detectedType = scope.toolUI.detectUIType(uiConfig.template);
          } catch (error) {
            this.logger.warn(`parseTools: failed to access toolUI for ${finalName}`, error);
            return item;
          }

          // Use centralized type guard from @frontmcp/ui/types
          const uiType: UIType = manifest?.uiType ?? (isUIType(detectedType) ? detectedType : 'auto');

          // Build meta keys based on platform type:
          // - OpenAI: openai/* keys only (ChatGPT proprietary format)
          // - ext-apps: ui/* keys only per SEP-1865 MCP Apps specification
          // - Other platforms: ui/* keys only (Claude, Cursor, etc.)
          const meta: Record<string, unknown> = {};
          const isExtApps = platformType === 'ext-apps';

          // Use custom resourceUri from config if provided, otherwise auto-generate
          const widgetUri = uiConfig.resourceUri || `ui://widget/${encodeURIComponent(finalName)}.html`;

          if (isOpenAIPlatform) {
            // OpenAI-specific meta keys for ChatGPT widget discovery
            // ChatGPT only understands openai/* keys - don't mix with ui/* keys
            meta['openai/outputTemplate'] = widgetUri;
            meta['openai/resultCanProduceWidget'] = true;
            meta['openai/widgetAccessible'] = uiConfig.widgetAccessible ?? false;

            // Add invocation status if configured
            if (uiConfig.invocationStatus?.invoking) {
              meta['openai/toolInvocation/invoking'] = uiConfig.invocationStatus.invoking;
            }
            if (uiConfig.invocationStatus?.invoked) {
              meta['openai/toolInvocation/invoked'] = uiConfig.invocationStatus.invoked;
            }
          } else if (isExtApps) {
            // SEP-1865 MCP Apps specification uses ui/* keys only
            meta['ui/resourceUri'] = widgetUri;
            meta['ui/mimeType'] = 'text/html+mcp';

            // Add widget capabilities if configured (for ext-apps initialization)
            // Map flattened config to spec-compliant structure (ExtAppsWidgetCapabilities)
            if (uiConfig.widgetCapabilities) {
              const capabilities: { tools?: { listChanged?: boolean }; supportsPartialInput?: boolean } = {};

              if (uiConfig.widgetCapabilities.toolListChanged !== undefined) {
                capabilities.tools = { listChanged: uiConfig.widgetCapabilities.toolListChanged };
              }
              if (uiConfig.widgetCapabilities.supportsPartialInput !== undefined) {
                capabilities.supportsPartialInput = uiConfig.widgetCapabilities.supportsPartialInput;
              }

              if (Object.keys(capabilities).length > 0) {
                meta['ui/capabilities'] = capabilities;
              }
            }

            // Add manifest info for ext-apps (uses ui/* namespace)
            meta['ui/cdn'] = buildCDNInfoForUIType(uiType);
            if (manifest) {
              meta['ui/type'] = manifest.uiType;
              meta['ui/manifestUri'] = `ui://widget/${encodeURIComponent(finalName)}/manifest.json`;
              meta['ui/displayMode'] = manifest.displayMode;
              meta['ui/bundlingMode'] = manifest.bundlingMode;
            } else if (uiConfig.template) {
              meta['ui/type'] = uiType;
            }
          } else {
            // Generic MCP clients (Claude, Cursor, etc.) - use ui/* namespace only
            meta['ui/resourceUri'] = widgetUri;
            meta['ui/mimeType'] = 'text/html+mcp';

            // Add invocation status if configured (use ui/* namespace)
            if (uiConfig.invocationStatus?.invoking) {
              meta['ui/toolInvocation/invoking'] = uiConfig.invocationStatus.invoking;
            }
            if (uiConfig.invocationStatus?.invoked) {
              meta['ui/toolInvocation/invoked'] = uiConfig.invocationStatus.invoked;
            }

            // Add manifest/CDN info
            meta['ui/cdn'] = buildCDNInfoForUIType(uiType);
            if (manifest) {
              meta['ui/type'] = manifest.uiType;
              meta['ui/manifestUri'] = `ui://widget/${encodeURIComponent(finalName)}/manifest.json`;
              meta['ui/displayMode'] = manifest.displayMode;
              meta['ui/bundlingMode'] = manifest.bundlingMode;
            } else if (uiConfig.template) {
              meta['ui/type'] = uiType;
            }
          }

          item._meta = meta;
        }

        return item;
      });

      const preview = this.sample(tools.map((t) => t.name)).join(', ');
      const extra = tools.length > 5 ? `, +${tools.length - 5} more` : '';
      this.logger.info(`parseTools: prepared ${tools.length} tool descriptor(s): ${preview}${extra}`);

      // Respond with tools and optional nextCursor for pagination
      if (nextCursor) {
        this.respond({ tools, nextCursor });
      } else {
        this.respond({ tools });
      }
      this.logger.info('parseTools: response sent');
      this.logger.verbose('parseTools:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parseTools: failed to parse tools', error);
      throw error;
    }
  }
}
