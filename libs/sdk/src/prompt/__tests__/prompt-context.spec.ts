import 'reflect-metadata';

import { type GetPromptResult } from '@frontmcp/protocol';

import { App, LogLevel, Prompt, PromptContext, Tool, ToolContext } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const fetched: string[] = [];

@Prompt({ name: 'whoami', arguments: [] })
class WhoAmIPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    const response = await this.fetch('https://api.example.com/profile');
    const facts = {
      sub: this.auth.user.sub,
      hasRequestId: typeof this.context.requestId === 'string',
      flow: this.context.flow?.name,
      scope: this.context.scope?.id === this.scope.id,
      fetched: await response.text(),
    };
    return { messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(facts) } }] };
  }
}

@Tool({ name: 'where_am_i', inputSchema: {} })
class WhereAmITool extends ToolContext {
  async execute() {
    return { flow: this.context.flow?.name, scope: this.context.scope?.id === this.scope.id };
  }
}

@Tool({ name: 'slow', inputSchema: {} })
class SlowTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { done: true };
  }
}

@Tool({ name: 'parallel_flows', inputSchema: {} })
class ParallelFlowsTool extends ToolContext {
  async execute() {
    const seen: Array<string | undefined> = [];
    const listPrompts = this.scope
      .runFlowForOutput('prompts:list-prompts', {
        request: { method: 'prompts/list', params: {} },
        ctx: { authInfo: this.authInfo },
      } as never)
      .then(() => seen.push(this.context.flow?.name));
    await Promise.all([listPrompts, this.callTool('slow', {})]);
    return { flow: this.context.flow?.name, afterListPrompts: seen[0] };
  }
}

@App({ id: 'desk', name: 'Desk', prompts: [WhoAmIPrompt], tools: [WhereAmITool, SlowTool, ParallelFlowsTool] })
class DeskApp {}

describe('prompt context', () => {
  let server: DirectMcpServer;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response('profile');
    }) as typeof fetch;
    server = await FrontMcpInstance.createDirect({
      info: { name: 'prompt-context', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await server.dispose();
  });

  it('gives a prompt this.auth, this.context and this.fetch()', async () => {
    const result = await server.getPrompt('whoami', {}, { authContext: { user: { sub: 'nour' } } });
    const content = result.messages[0]?.content;
    const facts = JSON.parse(content?.type === 'text' ? content.text : '{}');

    expect(facts).toEqual(
      expect.objectContaining({ sub: 'nour', hasRequestId: true, fetched: 'profile', flow: 'prompts:get-prompt' }),
    );
    expect(fetched).toEqual(['https://api.example.com/profile']);
  });

  it('sets this.context.flow and this.context.scope to the flow running and its scope', async () => {
    const result = await server.callTool('where_am_i', {});

    expect(result.structuredContent).toEqual({ flow: 'tools:call-tool', scope: true });
  });

  it('keeps this.context.flow on the flow running in each async call chain when flows run in parallel', async () => {
    const result = await server.callTool('parallel_flows', {});

    expect(result.structuredContent).toEqual({ flow: 'tools:call-tool', afterListPrompts: 'tools:call-tool' });
  });
});
