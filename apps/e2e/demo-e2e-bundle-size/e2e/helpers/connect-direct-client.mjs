// Imports an SDK entry, connects a direct client, calls a tool and prints the MCP client modules loaded before and after connecting: node connect-direct-client.mjs <sdkEntry>
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const CLIENT_MODULE =
  /\/@modelcontextprotocol\/sdk\/dist\/(esm|cjs)\/client\/|\/protocol\/dist\/(esm\/)?(clients?|lazy-client)\.m?js$/;
const loadedClientModules = [];
registerHooks({
  load(url, context, nextLoad) {
    if (CLIENT_MODULE.test(url)) loadedClientModules.push(url);
    return nextLoad(url, context);
  },
});

const [sdkEntry] = process.argv.slice(2);
const { app, connect, LogLevel, Tool, ToolContext, z } = await import(pathToFileURL(sdkEntry).href);
const beforeConnect = [...loadedClientModules];

class GreetTool extends ToolContext {
  async execute({ name }) {
    return `Hello, ${name}`;
  }
}
Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })(GreetTool);

const client = await connect({
  info: { name: 'esm-client', version: '1.0.0' },
  apps: [app({ id: 'greetings', name: 'Greetings', tools: [GreetTool] })],
  logging: { level: LogLevel.Off },
});
try {
  const result = await client.callTool('greet', { name: 'FrontMCP' });
  process.stdout.write(JSON.stringify({ beforeConnect, afterConnect: loadedClientModules, result }));
} finally {
  await client.close();
}
