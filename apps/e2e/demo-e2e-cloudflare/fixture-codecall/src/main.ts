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

// CodeCall with its default runtime. In a Worker that is the Node VM, which CodeCall must refuse
// clearly there: the Worker bundle carries only Enclave's worker-safe entry point.
@App({
  id: 'cf-codecall-app',
  name: 'cf-codecall-app',
  tools: [GetUserTool],
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
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
