import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

@Tool({
  name: 'users:count',
  description: 'Counts the users of the account',
  inputSchema: {},
  outputSchema: z.object({ count: z.number() }),
})
class CountUsersTool extends ToolContext {
  async execute() {
    return { count: 3 };
  }
}

@Tool({ name: 'users:greet', description: 'Greets the users of the account', inputSchema: {} })
class GreetUsersTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'hello' }] };
  }
}

@App({ id: 'crm', name: 'CRM', tools: [CountUsersTool, GreetUsersTool], plugins: [CodeCallPlugin.init()] })
class CrmApp {}

describe('codecall:invoke through a client that listed the tools (#718)', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-invoke-output-schema', version: '1.0.0' },
      apps: [CrmApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const server = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'codecall-invoke-output-schema-spec', version: '1.0.0' });
    await client.connect(server.clientTransport);
    closeServer = () => server.close();
    await client.listTools();
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  it('advertises no output schema, since it returns the invoked tool result as is', async () => {
    const { tools } = await client.listTools();
    const invokeTool = tools.find((tool) => tool.name === 'codecall:invoke');

    expect(invokeTool).toBeDefined();
    expect(invokeTool?.outputSchema).toBeUndefined();
  });

  it('returns the structured content of an invoked tool that declares an output schema', async () => {
    const result = await client.callTool({ name: 'codecall:invoke', arguments: { tool: 'users:count', input: {} } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ count: 3 });
  });

  it('returns the result of an invoked tool that has no structured content', async () => {
    const result = await client.callTool({ name: 'codecall:invoke', arguments: { tool: 'users:greet', input: {} } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
