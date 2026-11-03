import { create, Tool, ToolContext, z } from '@frontmcp/sdk';

class GreetTool extends ToolContext {
  async execute({ name }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

async function greet() {
  const server = await create({ info: { name: 'web-worker', version: '1.0.0' }, tools: [GreetTool] });
  try {
    return await server.callTool('greet', { name: 'FrontMCP' });
  } finally {
    await server.dispose();
  }
}

greet().then(
  (result) => self.postMessage({ result }),
  (error) => self.postMessage({ error: String(error?.stack ?? error) }),
);
