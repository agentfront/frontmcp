/**
 * `@Agent({ approval })` gates the agent's `invoke_<agent>` tool: the agent is called only through
 * that tool, and the approval check reads the requirement from the tool's metadata.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalPlugin, ApprovalRequiredError } from '../index';

/** The gate keys approvals by the tool's full name, which includes its app id. */
const AGENT_TOOL_ID = 'ops:invoke_release';

const releases: string[] = [];

const llmAdapter = {
  completion: jest.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }),
};

@Agent({
  name: 'release',
  description: 'Ships a release',
  inputSchema: {},
  llm: { adapter: llmAdapter },
  approval: true,
})
class ReleaseAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    releases.push('shipped');
    return { shipped: true };
  }
}

@Tool({ name: 'approve_release', description: 'Grants this session approval to release', inputSchema: {} })
class ApproveReleaseTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(AGENT_TOOL_ID);
    return { approved: true };
  }
}

async function callTool(server: DirectMcpServer, name: string, authContext: DirectAuthContext): Promise<unknown> {
  try {
    return await server.callTool(name, {}, { authContext });
  } catch (error) {
    return error;
  }
}

describe('ApprovalPlugin on an @Agent', () => {
  let storage: RootStorage;
  let server: DirectMcpServer;
  const caller: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };

  beforeEach(async () => {
    releases.length = 0;
    storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'ops',
      name: 'Ops',
      plugins: [ApprovalPlugin.init({ storageInstance: storage })],
      agents: [ReleaseAgent],
      tools: [ApproveReleaseTool],
    })
    class OpsApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-agents', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('refuses invoke_<agent> when nothing has approved it', async () => {
    const result = await callTool(server, 'invoke_release', caller);

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(releases).toEqual([]);
  });

  it('runs invoke_<agent> once the caller holds an approval', async () => {
    await callTool(server, 'approve_release', caller);

    const result = await callTool(server, 'invoke_release', caller);

    expect(result).not.toBeInstanceOf(Error);
    expect(releases).toEqual(['shipped']);
  });
});
