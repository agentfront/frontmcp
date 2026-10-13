// Creates a server with one tool from an SDK entry, calls the tool and prints its result as JSON: node call-greet-tool.mjs <sdkEntry> [<moduleToLoadFirst>]
import { pathToFileURL } from 'node:url';

const [sdkEntry, moduleToLoadFirst] = process.argv.slice(2);
if (moduleToLoadFirst) await import(pathToFileURL(moduleToLoadFirst).href);
const { create, Tool, ToolContext, z } = await import(pathToFileURL(sdkEntry).href);

class GreetTool extends ToolContext {
  async execute({ name }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

const server = await create({ info: { name: 'module-order', version: '1.0.0' }, tools: [GreetTool] });
try {
  process.stdout.write(JSON.stringify(await server.callTool('greet', { name: 'FrontMCP' })));
} finally {
  await server.dispose();
}
