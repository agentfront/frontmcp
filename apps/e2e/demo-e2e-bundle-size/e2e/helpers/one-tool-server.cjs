// A one-tool FrontMCP server over Streamable HTTP, measured over IPC (#948): node --expose-gc one-tool-server.cjs <sdkEntry> <port>
// Sent `measure`, it runs a full GC and answers with its live heap, new space, RSS and the packages it loaded.
const v8 = require('node:v8');

const [sdkEntry, port] = process.argv.slice(2);
const { App, FrontMcp, LogLevel, Tool, ToolContext, z } = require(sdkEntry);

class AddTool extends ToolContext {
  async execute({ a, b }) {
    return { content: [{ type: 'text', text: String(a + b) }] };
  }
}
Tool({ name: 'add', description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } })(AddTool);
class MemoryApp {}
App({ name: 'memory', tools: [AddTool] })(MemoryApp);
class Server {}
FrontMcp({
  info: { name: 'server-memory', version: '1.0.0' },
  apps: [MemoryApp],
  logging: { level: LogLevel.Warn },
  http: { port: Number(port) },
})(Server);

process.on('message', (message) => {
  if (message !== 'measure') return;
  globalThis.gc();
  const newSpace = v8.getHeapSpaceStatistics().find((space) => space.space_name === 'new_space');
  const { heapUsed, rss } = process.memoryUsage();
  const packages = new Set();
  for (const file of Object.keys(require.cache)) {
    const match = /.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(file);
    if (match) packages.add(match[1].replace('\\', '/'));
  }
  process.send({ liveHeap: heapUsed, newSpace: newSpace.space_size, rss, packages: [...packages] });
});
