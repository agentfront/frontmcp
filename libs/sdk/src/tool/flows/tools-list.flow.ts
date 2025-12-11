// tools/flows/list-tools.flow.ts
import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, ToolEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { ListToolsRequestSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';
import { hasUIConfig } from '../ui';
import { buildCDNInfoForUIType } from '@frontmcp/ui/build';
import type { Scope } from '../../scope/scope.instance';

const inputSchema = z.object({
  request: ListToolsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListToolsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
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
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid request format', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'tools/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'tools/list');
    }

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set('cursor', cursor);
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

        // Add OpenAI _meta for tools with UI configuration
        // This is CRITICAL for ChatGPT to discover widget-producing tools at listing time
        // NOTE: Use static URI (like pizzaz example: ui://widget/tool-name.html), NOT template with {requestId}
        // OpenAI tries to fetch the outputTemplate URI directly at discovery time
        if (hasUIConfig(tool.metadata)) {
          const uiConfig = tool.metadata.ui;
          if (!uiConfig) {
            // This should never happen if hasUIConfig returned true
            return item;
          }

          // Get manifest info from registry (if available)
          const scope = this.scope as Scope;
          const manifest = scope.toolUI.getManifest(finalName);

          // Detect UI type for CDN info
          const uiType = manifest?.uiType ?? scope.toolUI.detectUIType(uiConfig.template);

          // Always include outputTemplate for all UI tools
          // - static mode: Full widget with React runtime and bridge
          // - inline mode: Lean shell (just HTML + theme), actual widget comes in tool response
          const meta: Record<string, unknown> = {
            'openai/outputTemplate': `ui://widget/${encodeURIComponent(finalName)}.html`,
            'openai/resultCanProduceWidget': true,
            'openai/widgetAccessible': uiConfig.widgetAccessible ?? false,
            // CDN info for client-side resource loading
            'ui/cdn': buildCDNInfoForUIType(uiType),
          };

          // Add manifest information for client-side renderer selection
          if (manifest) {
            meta['ui/type'] = manifest.uiType;
            meta['ui/manifestUri'] = `ui://widget/${encodeURIComponent(finalName)}/manifest.json`;
            meta['ui/displayMode'] = manifest.displayMode;
            meta['ui/bundlingMode'] = manifest.bundlingMode;
          } else if (uiConfig.template) {
            // Fallback to detecting UI type from template
            meta['ui/type'] = uiType;
            // Note: ui/manifestUri is only set when a manifest exists in the registry
          }

          // Add invocation status if configured
          if (uiConfig.invocationStatus?.invoking) {
            meta['openai/toolInvocation/invoking'] = uiConfig.invocationStatus.invoking;
          }
          if (uiConfig.invocationStatus?.invoked) {
            meta['openai/toolInvocation/invoked'] = uiConfig.invocationStatus.invoked;
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
