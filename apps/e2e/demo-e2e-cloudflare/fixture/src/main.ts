import 'reflect-metadata';

import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echo back the input message',
  inputSchema: { message: z.string() },
})
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { content: [{ type: 'text' as const, text: `Echo: ${input.message}` }] };
  }
}

@App({ id: 'cf-worker-app', name: 'cf-worker-app', tools: [EchoTool] })
class CfWorkerApp {}

@FrontMcp({
  info: { name: 'cf-worker-fixture', version: '1.0.0' },
  apps: [CfWorkerApp],
  // Config-driven worker endpoint: serve MCP at /mcp (default is the worker
  // root `/`). The same `http` block drives the Express host and the worker.
  http: { entryPath: '/mcp' },
  // Background tasks need distributed storage (Redis/Upstash) on edge runtimes;
  // this fixture has none, so disable them. (A real worker would configure
  // tasks.redis or leave them off.)
  tasks: { enabled: false },
})
class CfWorkerServer {}

export default CfWorkerServer;
