/**
 * The approval gate runs through the real tools:call-tool flow (GHSA-r848-p7wf-96rc).
 *
 * The check hook lives on `ApprovalCheckPlugin`, which `ApprovalPlugin` only mentioned from a
 * static method the SDK never calls, so the documented `plugins: [ApprovalPlugin.init()]`
 * gated nothing. These specs build a real server and call the tools through the flow, so a
 * hook that is never registered fails them.
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
  type PluginType,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalCheckPlugin, ApprovalPlugin, ApprovalRequiredError, ApprovalScope, ApprovalState } from '../index';
import { ApprovalStorageStore } from '../stores';

const PRE_APPROVED_CONTEXT = { type: 'deployment', identifier: 'prod-eu-blue' };

/** The gate keys approvals by the tool's full name, which includes its app id. */
const DEPLOY_TOOL_ID = 'ops:deploy_service';

const executedDeployments: string[] = [];

@Tool({
  name: 'deploy_service',
  description: 'Deploys a service to production',
  inputSchema: {
    service: z.string(),
    context: z.object({ type: z.string(), identifier: z.string() }).optional(),
  },
  approval: { required: true, preApprovedContexts: [PRE_APPROVED_CONTEXT] },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    executedDeployments.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({ name: 'approve_deploy', description: 'Grants this caller session approval to deploy', inputSchema: {} })
class ApproveDeployTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(DEPLOY_TOOL_ID);
    return { approved: true };
  }
}

async function createServer(plugins: PluginType[]): Promise<DirectMcpServer> {
  @App({ id: 'ops', name: 'Ops', plugins, tools: [DeployServiceTool, ApproveDeployTool] })
  class OpsApp {}

  return FrontMcpInstance.createDirect({
    info: { name: 'approval-enforcement', version: '1.0.0' },
    apps: [OpsApp],
    logging: { level: LogLevel.Off },
  });
}

async function callTool(
  server: DirectMcpServer,
  name: string,
  args: Record<string, unknown>,
  authContext?: DirectAuthContext,
): Promise<unknown> {
  try {
    return await server.callTool(name, args, { authContext });
  } catch (error) {
    return error;
  }
}

function statelessCaller(sub: string, extra?: Record<string, unknown>): DirectAuthContext {
  return { sessionId: STATELESS_SESSION_ID, user: { sub }, extra };
}

async function recordUserDenial(storage: RootStorage, userId: string): Promise<void> {
  const denial = {
    toolId: DEPLOY_TOOL_ID,
    state: ApprovalState.DENIED,
    scope: ApprovalScope.USER,
    grantedAt: Date.now(),
    userId,
    grantedBy: { source: 'admin', identifier: 'security-team' },
  };
  await storage.namespace('approval').set(`${DEPLOY_TOOL_ID}:user:${userId}`, JSON.stringify(denial));
}

const configurations: Array<[string, (storage: RootStorage) => PluginType[]]> = [
  ['ApprovalPlugin.init()', (storage) => [ApprovalPlugin.init({ storageInstance: storage })]],
  [
    'ApprovalPlugin.init() with ApprovalCheckPlugin listed explicitly',
    (storage) => [ApprovalPlugin.init({ storageInstance: storage }), ApprovalCheckPlugin],
  ],
  [
    'ApprovalPlugin.init({ inject, useFactory })',
    (storage) => [ApprovalPlugin.init({ inject: () => [], useFactory: () => ({ storageInstance: storage }) })],
  ],
];

describe.each(configurations)('approval gate through tools:call-tool with %s (GHSA-r848-p7wf-96rc)', (_, plugins) => {
  let storage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    executedDeployments.length = 0;
    storage = createMemoryStorage();
    await storage.connect();
    server = await createServer(plugins(storage));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server.dispose();
  });

  it('refuses a tool that requires approval when nothing has approved it', async () => {
    const result = await callTool(server, 'deploy_service', { service: 'api' }, statelessCaller('alice'));

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('refuses the pre-approved context when the caller supplies it as an argument', async () => {
    const result = await callTool(
      server,
      'deploy_service',
      { service: 'api', context: PRE_APPROVED_CONTEXT },
      statelessCaller('alice'),
    );

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('refuses a server-established context that is not pre-approved', async () => {
    const result = await callTool(
      server,
      'deploy_service',
      { service: 'api', context: PRE_APPROVED_CONTEXT },
      statelessCaller('alice', { approvalContext: { type: 'deployment', identifier: 'staging' } }),
    );

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('runs the tool in a pre-approved context established by the server', async () => {
    const result = await callTool(
      server,
      'deploy_service',
      { service: 'api' },
      statelessCaller('alice', { approvalContext: PRE_APPROVED_CONTEXT }),
    );

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['api']);
  });

  it('keeps a recorded denial even when the server-established context is pre-approved', async () => {
    await recordUserDenial(storage, 'alice');

    const result = await callTool(
      server,
      'deploy_service',
      { service: 'api' },
      statelessCaller('alice', { approvalContext: PRE_APPROVED_CONTEXT }),
    );

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect((result as ApprovalRequiredError).details.state).toBe('denied');
    expect(executedDeployments).toEqual([]);
  });

  it('keeps a user-level denial even when the session holds an approval', async () => {
    const caller: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };
    await callTool(server, 'approve_deploy', {}, caller);
    await recordUserDenial(storage, 'alice');

    const result = await callTool(server, 'deploy_service', { service: 'api' }, caller);

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect((result as ApprovalRequiredError).details.state).toBe('denied');
    expect(executedDeployments).toEqual([]);
  });

  it('runs the tool after the same caller is granted session approval', async () => {
    const caller: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };
    await callTool(server, 'approve_deploy', {}, caller);

    const result = await callTool(server, 'deploy_service', { service: 'api' }, caller);

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['api']);
  });

  it('does not let one stateless caller inherit the session approval of another', async () => {
    await callTool(server, 'approve_deploy', {}, statelessCaller('alice'));

    const bobResult = await callTool(server, 'deploy_service', { service: 'bob-api' }, statelessCaller('bob'));
    const aliceResult = await callTool(server, 'deploy_service', { service: 'alice-api' }, statelessCaller('alice'));

    expect(bobResult).toBeInstanceOf(ApprovalRequiredError);
    expect(aliceResult).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['alice-api']);
  });

  it('checks approval once per call', async () => {
    const getApproval = jest.spyOn(ApprovalStorageStore.prototype, 'getApproval');

    await callTool(server, 'deploy_service', { service: 'api' }, statelessCaller('alice'));

    expect(getApproval).toHaveBeenCalledTimes(1);
  });
});
