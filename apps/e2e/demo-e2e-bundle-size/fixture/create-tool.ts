import { create, Tool, ToolContext, z } from '@frontmcp/sdk';

class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

export const serverPromise = create({ info: { name: 'bundle-size', version: '1.0.0' }, tools: [GreetTool] });
