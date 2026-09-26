/** Find stages reuse the entry hook-owner resolution looked up, unless a hook retargets the request (#598). */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type ScopeEntry,
} from '../../common';

const GetPromptHook = FlowHooksOf('prompts:get-prompt');

function textPrompt(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

@Plugin({ name: 'prompt-retarget' })
class PromptRetargetPlugin {
  @GetPromptHook.Will('findPrompt')
  retarget(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    const { input } = ctx.state;
    if (input?.name === 'legacy-summary') ctx.state.set('input', { ...input, name: 'order-summary' });
  }
}

@Tool({ name: 'list_orders', inputSchema: {} })
class ListOrdersTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Resource({ name: 'order-feed', uri: 'orders://feed' })
class OrderFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'feed' }] };
  }
}

@Prompt({ name: 'order-summary', arguments: [] })
class OrderSummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('order summary');
  }
}

@Prompt({ name: 'legacy-summary', arguments: [] })
class LegacySummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt('legacy summary');
  }
}

@App({
  id: 'orders',
  name: 'Orders',
  plugins: [PromptRetargetPlugin],
  tools: [ListOrdersTool],
  resources: [OrderFeedResource],
  prompts: [OrderSummaryPrompt, LegacySummaryPrompt],
})
class OrdersApp {}

describe('find stages reuse the entry hook-owner resolution found (#598)', () => {
  let server: TestFetchServer;
  let scope: ScopeEntry;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'owner-entry-reuse', version: '1.0.0' }, apps: [OrdersApp] });
    const [firstScope] = server.instance.getScopes();
    if (!firstScope) throw new Error('the server has no scope');
    scope = firstScope;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('looks the tool up once per tools/call', async () => {
    // Run the flow on its own: the 2026-07-28 transport lists tools itself to validate the request.
    const getTools = jest.spyOn(scope.tools, 'getTools');

    const result = await scope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'list_orders', arguments: {} } },
      ctx: { authInfo: { sessionId: 'owner-entry-reuse', clientId: 'owner-entry-reuse' } },
    });

    expect(result.isError).toBeFalsy();
    expect(getTools.mock.calls.filter(([includeHidden]) => includeHidden === true)).toHaveLength(1);
  });

  it('looks the resource up once per resources/read', async () => {
    const findResourceForUri = jest.spyOn(scope.resources, 'findResourceForUri');

    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'orders://feed' });

    expect(message.error).toBeUndefined();
    expect(findResourceForUri).toHaveBeenCalledTimes(1);
  });

  it('looks the prompt up once per prompts/get', async () => {
    const findByName = jest.spyOn(scope.prompts, 'findByName');

    const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'order-summary' });

    expect(message.error).toBeUndefined();
    expect(findByName).toHaveBeenCalledTimes(1);
  });

  it('looks the completion reference up once per completion/complete', async () => {
    const findByName = jest.spyOn(scope.prompts, 'findByName');

    const { message } = await rpc20260728(server.handler, 'completion/complete', {
      ref: { type: 'ref/prompt', name: 'order-summary' },
      argument: { name: 'topic', value: '' },
    });

    expect(message.error).toBeUndefined();
    expect(findByName).toHaveBeenCalledTimes(1);
  });

  it('looks the prompt up again when a hook retargets the request before findPrompt', async () => {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'legacy-summary' });

    expect(JSON.stringify(message.result)).toContain('order summary');
    expect(JSON.stringify(message.result)).not.toContain('legacy summary');
  });
});
