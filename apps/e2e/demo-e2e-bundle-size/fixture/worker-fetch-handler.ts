import { app, FrontMcpInstance, LogLevel, Tool, ToolContext, z } from '@frontmcp/sdk';

class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

export const handlerPromise = FrontMcpInstance.createFetchHandler({
  info: { name: 'worker-bundle', version: '1.0.0' },
  apps: [app({ id: 'greetings', name: 'Greetings', tools: [GreetTool] })],
  http: { entryPath: '/mcp' },
  logging: { level: LogLevel.Off },
});
