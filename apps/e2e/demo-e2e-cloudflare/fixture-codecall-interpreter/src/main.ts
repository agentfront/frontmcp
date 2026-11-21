import 'reflect-metadata';

import { CodeCallPlugin } from '@frontmcp/plugin-codecall';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'users.get',
  description: 'Get a user by id',
  inputSchema: { id: z.number() },
})
class GetUserTool extends ToolContext {
  async execute(input: { id: number }) {
    return { id: input.id, name: `user-${input.id}` };
  }
}

// Run validated AgentScript in the Worker with Enclave's worker-safe interpreter.
@App({
  id: 'cf-codecall-app',
  name: 'cf-codecall-app',
  tools: [GetUserTool],
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only', vm: { preset: 'secure', runtime: 'interpreter' } })],
})
class CfCodecallApp {}

@FrontMcp({
  info: { name: 'cf-codecall-fixture', version: '1.0.0' },
  apps: [CfCodecallApp],
  http: { entryPath: '/mcp' },
  tasks: { enabled: false },
})
class CfCodecallServer {}

export default CfCodecallServer;
