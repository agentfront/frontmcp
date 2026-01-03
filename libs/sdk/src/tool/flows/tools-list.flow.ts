// tools/flows/list-tools.flow.ts
import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, ToolEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { ListToolsRequestSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';
import { hasUIConfig } from '../ui';
import { buildCDNInfoForUIType, type UIType } from '@frontmcp/uipack/build';
import { isUIType } from '@frontmcp/uipack/types';
import type { AIPlatformType } from '@frontmcp/uipack/adapters';
import type { Scope } from '../../scope/scope.instance';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const inputSchema = z.object({
  request: ListToolsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListToolsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  // z.any() used because AuthInfo is an external type from @modelcontextprotocol/sdk that varies by SDK version
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
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

type ResponseToolItem = z.infer<typeof outputSchema>['tools'][number];

// TODO: add support for pagination
// TODO: add support for session based tools
const plan = {
  pre: ['parseInput'],
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

    // Extract authInfo and detect platform type
    const authInfo = ctx?.authInfo;
    const sessionId = authInfo?.sessionId;

    // Cast scope to access notifications service for platform detection
    const scope = this.scope as Scope;

    // Get platform type: first check sessionIdPayload (detected from user-agent),
    // then fall back to notification service (detected from MCP clientInfo),
    // finally default to 'unknown'
    const platformType: AIPlatformType =
      authInfo?.sessionIdPayload?.platformType ??
      (sessionId ? scope.notifications?.getPlatformType(sessionId) : undefined) ??
      'unknown';

    this.logger.verbose(`parseInput: detected platform=${platformType}`);

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set({ cursor, authInfo, platformType });
    this.logger.verbose('parseInput:done');
  }

  @Stage('findTools')
  async findTools() {
    this.logger.info('findTools:start');

    try {
      const apps = this.scope.apps.getApps();
      this.logger.info(`findTools: discovered ${apps.length} app(s)`);

      const tools: Array<{ appName: string; tool: ToolEntry }> = [];

      const scopeTools = this.scope.tools.getTools();
      this.logger.verbose(`findTools: scope tools=${scopeTools.length}`);

      for (const tool of scopeTools) {
        tools.push({ appName: tool.owner.id, tool });
      }

      // Note: Agent tools (use-agent:*) are now registered as standard ToolInstances
      // in the ToolRegistry by AgentRegistry.registerAgentToolsInParentScope().
      // They are included automatically via scope.tools.getTools() above.

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
      const resolved = this.state.required.resolvedTools;
      const platformType = this.state.platformType ?? 'unknown';

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
          const widgetUri = `ui://widget/${encodeURIComponent(finalName)}.html`;

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

      this.respond({ tools });
      this.logger.info('parseTools: response sent');
      this.logger.verbose('parseTools:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parseTools: failed to parse tools', error);
      throw error;
    }
  }
}
