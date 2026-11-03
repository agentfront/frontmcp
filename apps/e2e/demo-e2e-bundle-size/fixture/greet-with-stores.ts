import { create, Tool, ToolContext, z } from '@frontmcp/sdk';

class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

/** Start a server with these server options, as a page would, and call its tool. */
export async function greetWith(options: Omit<Parameters<typeof create>[0], 'info'>): Promise<unknown> {
  const server = await create({ info: { name: 'browser-stores', version: '1.0.0' }, tools: [GreetTool], ...options });
  try {
    return await server.callTool('greet', { name: 'FrontMCP' });
  } finally {
    await server.dispose();
  }
}
