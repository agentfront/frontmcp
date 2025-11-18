// tools/flows/list-tools.flow.ts
import {Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, ToolEntry} from '../../common';
import 'reflect-metadata';
import {z} from 'zod';
import {ListToolsRequestSchema, ListToolsResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {zodToJsonSchema} from 'zod-to-json-schema';

const inputSchema = z.object({
  request: ListToolsRequestSchema,
  ctx: z.any(),
});

const outputSchema = ListToolsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  tools: z.array(
    z.object({
      appName: z.string(),
      tool: z.instanceof(ToolEntry),
    })
  ),
  resolvedTools: z.array(
    z.object({
      appName: z.string(),
      tool: z.instanceof(ToolEntry),
      finalName: z.string(),
    })
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
const {Stage} = FlowHooksOf('tools:list-tools');

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
    const {
      request: {method, params},
    } = inputSchema.parse(this.rawInput);

    if (method !== 'tools/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new Error('Invalid method');
    }

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set('cursor', cursor);
    this.logger.verbose('parseInput:done');
  }

  @Stage('findTools')
  async findTools() {
    this.logger.info('findTools:start');
    const apps = this.scope.apps.getApps();
    this.logger.info(`findTools: discovered ${apps.length} app(s)`);

    const tools: Array<{ appName: string; tool: ToolEntry }> = [];

    const scopeTools = this.scope.tools.getTools();
    this.logger.verbose(`findTools: scope tools=${scopeTools.length}`);

    for (const tool of scopeTools) {
      tools.push({appName: tool.owner.id, tool});
    }
    this.logger.info(`findTools: total tools collected=${tools.length}`);
    if (tools.length === 0) {
      this.logger.warn('findTools: no tools found across apps');
    }

    this.state.set('tools', tools);
    this.logger.verbose('findTools:done');
  }

  @Stage('resolveConflicts')
  async resolveConflicts() {
    this.logger.verbose('resolveConflicts:start');
    const found = this.state.required.tools;

    const counts = new Map<string, number>();
    for (const {tool} of found) {
      const baseName = tool.metadata.id ?? tool.metadata.name;
      counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
    }

    const conflicts = new Set<string>(
      [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    );

    if (conflicts.size > 0) {
      const preview = this.sample(Array.from(conflicts)).join(', ');
      const extra = conflicts.size > 5 ? `, +${conflicts.size - 5} more` : '';
      this.logger.warn(`resolveConflicts: ${conflicts.size} name conflict(s) detected: ${preview}${extra}`);
    } else {
      this.logger.info('resolveConflicts: no name conflicts detected');
    }

    const resolved = found.map(({appName, tool}) => {
      const baseName = tool.metadata.id ?? tool.metadata.name;
      const finalName = conflicts.has(baseName) ? `${appName}:${baseName}` : baseName;
      return {appName, tool, finalName};
    });

    this.state.set('resolvedTools', resolved);
    this.logger.verbose('resolveConflicts:done');
  }

  @Stage('parseTools')
  async parseTools() {
    this.logger.verbose('parseTools:start');
    const resolved = this.state.required.resolvedTools;

    const tools: ResponseToolItem[] = resolved.map(({finalName, tool}) => ({
      name: finalName,
      title: tool.metadata.name,
      description: tool.metadata.description,
      annotations: tool.metadata.annotations,
      inputSchema:
        (tool.metadata as any).rawInputSchema ??
        (zodToJsonSchema(z.object(tool.metadata.inputSchema) as any) as any),
    }));

    const preview = this.sample(tools.map(t => t.name)).join(', ');
    const extra = tools.length > 5 ? `, +${tools.length - 5} more` : '';
    this.logger.info(`parseTools: prepared ${tools.length} tool descriptor(s): ${preview}${extra}`);

    this.respond({tools});
    this.logger.info('parseTools: response sent');
    this.logger.verbose('parseTools:done');

  }
}
