// A server started with bootstrap() under FRONTMCP_DAEMON_SOCKET, as a daemon is, with a tool that takes a while.
require('reflect-metadata');
const { App, FrontMcpInstance, LogLevel, Tool, ToolContext } = require('@frontmcp/sdk');

class SlowTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.SLOW_TOOL_MS ?? 1000)));
    return 'finished';
  }
}
Tool({ name: 'slow', inputSchema: {} })(SlowTool);

class SlowApp {}
App({ id: 'slow', name: 'Slow', tools: [SlowTool] })(SlowApp);

FrontMcpInstance.bootstrap({
  info: { name: 'daemon-socket', version: '1.0.0' },
  apps: [SlowApp],
  logging: { level: LogLevel.Warn },
  auth: { mode: 'public' },
});
