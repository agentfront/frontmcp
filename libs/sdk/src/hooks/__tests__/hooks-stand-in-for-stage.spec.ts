import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  Plugin,
  Resource,
  ResourceContext,
  ResourceTemplate,
  ScopeEntry,
  Tool,
  ToolContext,
  type FlowCtxOf,
} from '../../common';

const ReadResourceHook = FlowHooksOf('resources:read-resource');
const ListToolsHook = FlowHooksOf('tools:list-tools');

@ResourceTemplate({ name: 'note', uriTemplate: 'notes://{id}', mimeType: 'text/plain' })
class NoteResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    return `Note ${params.id}`;
  }
}

@Resource({ name: 'agent-notes', uri: 'agent://notes', availableWhen: { surface: ['agent'] } })
class AgentNotesResource extends ResourceContext {
  async execute() {
    return 'for agents only';
  }
}

@Tool({ name: 'public_tool', inputSchema: {}, outputSchema: 'string' })
class PublicTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'hidden_by_hook', inputSchema: {}, outputSchema: 'string' })
class HiddenByHookTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'hidden_early', inputSchema: {}, outputSchema: 'string' })
class HiddenEarlyTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Plugin({ name: 'stand-in' })
class StandInPlugin {
  @ReadResourceHook.Around('findResource')
  async findAlias(flowCtx: FlowCtxOf<'resources:read-resource'>, next: () => Promise<void>) {
    const aliasTargets: Record<string, string> = {
      'alias://note': 'notes://aliased',
      'alias://agent': 'agent://notes',
    };
    const target = aliasTargets[flowCtx.uri];
    const match = target ? flowCtx.get(ScopeEntry).resources.findResourceForUri(target) : undefined;
    if (!match) return next();
    flowCtx.resolveResource({ resource: match.instance, params: match.params });
  }

  @ListToolsHook.Will('findTools')
  hideEarly(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    flowCtx.removeTool('hidden_early');
  }

  @ListToolsHook.Will('parseTools')
  hideTool(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    flowCtx.removeTool('hidden_by_hook');
  }
}

@App({
  id: 'notes',
  name: 'Notes',
  resources: [NoteResource, AgentNotesResource],
  tools: [PublicTool, HiddenByHookTool, HiddenEarlyTool],
  plugins: [StandInPlugin],
})
class NotesApp {}

describe('a hook that stands in for a stage', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'stand-in-hooks', version: '1.0.0' }, apps: [NotesApp] });
  });

  it("hands findResource's result over with ctx.resolveResource, params included", async () => {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'alias://note' });

    expect(message.error).toBeUndefined();
    expect(JSON.stringify(message.result)).toContain('Note aliased');
  });

  it('has the resource it hands over checked as findResource checks it (availableWhen)', async () => {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'alias://agent' });

    expect(message.error?.message).toBe('Resource not found: alias://agent');
  });

  it('leaves a tool out of tools/list with ctx.removeTool, called before or after the tools are found', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/list');
    const names = ((message.result?.['tools'] ?? []) as Array<{ name: string }>).map(({ name }) => name);

    expect(names).toContain('public_tool');
    expect(names).not.toContain('hidden_by_hook');
    expect(names).not.toContain('hidden_early');
  });
});
