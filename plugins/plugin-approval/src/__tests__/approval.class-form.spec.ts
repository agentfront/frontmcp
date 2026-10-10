/**
 * `plugins: [ApprovalPlugin]`, the class without `init()`, gates tools with the default options (#803).
 *
 * A plugin listed as its class got none of the providers its `static dynamicProviders` derives from
 * its options: the approval store and `this.approval` were missing, so a tool that grants an
 * approval failed and the gate could not read one.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  STATELESS_SESSION_ID,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import { ApprovalPlugin, ApprovalRequiredError } from '../index';

const executed: string[] = [];

@Tool({
  name: 'deploy',
  description: 'Deploys a service',
  inputSchema: { service: z.string() },
  approval: { required: true },
})
class DeployTool extends ToolContext {
  async execute(input: { service: string }) {
    executed.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({ name: 'approve_deploy', description: 'Grants this session approval to deploy', inputSchema: {} })
class ApproveDeployTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval('ops:deploy');
    return { approved: true };
  }
}

@App({ id: 'ops', name: 'Ops', plugins: [ApprovalPlugin], tools: [DeployTool, ApproveDeployTool] })
class OpsApp {}

const caller: DirectAuthContext = { sessionId: STATELESS_SESSION_ID, user: { sub: 'alice' } };

describe('plugins: [ApprovalPlugin] without init() (#803)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-class-form', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('refuses the tool until the caller is approved, then runs it', async () => {
    await expect(server.callTool('deploy', { service: 'api' }, { authContext: caller })).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    expect(executed).toEqual([]);

    const granted = await server.callTool('approve_deploy', {}, { authContext: caller });
    expect(granted.isError).toBeFalsy();

    const deployed = await server.callTool('deploy', { service: 'api' }, { authContext: caller });
    expect(deployed.isError).toBeFalsy();
    expect(executed).toEqual(['api']);
  });
});
