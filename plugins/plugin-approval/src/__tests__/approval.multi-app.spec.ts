/**
 * Two apps on one server, each installing `ApprovalPlugin.init()` with its own store.
 *
 * Each app's approval gate must judge only that app's tools against that app's store: one app's
 * gate must not refuse the other app's tools, and one app's pass must not skip the other's check.
 */
import 'reflect-metadata';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalPlugin, ApprovalRequiredError, ApprovalScope, ApprovalState } from '../index';

const ALPHA_DEPLOY_ID = 'alpha:alpha_deploy';
const BETA_DEPLOY_ID = 'beta:beta_deploy';
const SESSION_ID = 'session-alice';

const executedDeployments: string[] = [];

@Tool({ name: 'alpha_deploy', inputSchema: {}, approval: { required: true } })
class AlphaDeployTool extends ToolContext {
  async execute() {
    executedDeployments.push('alpha');
    return { deployed: 'alpha' };
  }
}

@Tool({ name: 'beta_deploy', inputSchema: {}, approval: { required: true } })
class BetaDeployTool extends ToolContext {
  async execute() {
    executedDeployments.push('beta');
    return { deployed: 'beta' };
  }
}

const CALLER: DirectAuthContext = { sessionId: SESSION_ID, user: { sub: 'alice' } };

async function callTool(server: DirectMcpServer, name: string): Promise<unknown> {
  try {
    return await server.callTool(name, {}, { authContext: CALLER });
  } catch (error) {
    return error;
  }
}

// Written to storage, not through `this.approval`, which resolves the last app's store (see #600).
async function recordApproval(storage: RootStorage, toolId: string, state: ApprovalState): Promise<void> {
  const record = {
    toolId,
    state,
    scope: ApprovalScope.SESSION,
    grantedAt: Date.now(),
    sessionId: SESSION_ID,
    grantedBy: { source: 'admin', identifier: 'security-team' },
  };
  await storage.namespace('approval').set(`${toolId}:session:${SESSION_ID}`, JSON.stringify(record));
}

describe('ApprovalPlugin installed on two apps of one server', () => {
  let alphaStorage: RootStorage;
  let betaStorage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    executedDeployments.length = 0;
    alphaStorage = createMemoryStorage();
    betaStorage = createMemoryStorage();
    await Promise.all([alphaStorage.connect(), betaStorage.connect()]);

    @App({
      id: 'alpha',
      name: 'Alpha',
      plugins: [ApprovalPlugin.init({ storageInstance: alphaStorage })],
      tools: [AlphaDeployTool],
    })
    class AlphaApp {}

    @App({
      id: 'beta',
      name: 'Beta',
      plugins: [ApprovalPlugin.init({ storageInstance: betaStorage })],
      tools: [BetaDeployTool],
    })
    class BetaApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-multi-app', version: '1.0.0' },
      apps: [AlphaApp, BetaApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('runs the second app tool once the second app store approves it', async () => {
    await recordApproval(betaStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['beta']);
  });

  it('runs the first app tool once the first app store approves it', async () => {
    await recordApproval(alphaStorage, ALPHA_DEPLOY_ID, ApprovalState.APPROVED);

    const result = await callTool(server, 'alpha_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['alpha']);
  });

  it('does not let an approval in the first app store admit the second app tool', async () => {
    await recordApproval(alphaStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('keeps a denial recorded in the second app store when the first app store approves', async () => {
    await recordApproval(alphaStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);
    await recordApproval(betaStorage, BETA_DEPLOY_ID, ApprovalState.DENIED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect((result as ApprovalRequiredError).details.state).toBe('denied');
    expect(executedDeployments).toEqual([]);
  });
});

describe('ApprovalPlugin installed on the server and on an app, each with its own store', () => {
  let serverStorage: RootStorage;
  let appStorage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    executedDeployments.length = 0;
    serverStorage = createMemoryStorage();
    appStorage = createMemoryStorage();
    await Promise.all([serverStorage.connect(), appStorage.connect()]);

    @App({
      id: 'beta',
      name: 'Beta',
      plugins: [ApprovalPlugin.init({ storageInstance: appStorage })],
      tools: [BetaDeployTool],
    })
    class BetaApp {}

    @Plugin({ name: 'server-approvals', plugins: [ApprovalPlugin.init({ storageInstance: serverStorage })] })
    class ServerApprovalsPlugin {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-server-and-app', version: '1.0.0' },
      apps: [BetaApp],
      plugins: [ServerApprovalsPlugin],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('keeps the app store denial when the server store approves', async () => {
    await recordApproval(serverStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);
    await recordApproval(appStorage, BETA_DEPLOY_ID, ApprovalState.DENIED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('keeps the server store denial when the app store approves', async () => {
    await recordApproval(serverStorage, BETA_DEPLOY_ID, ApprovalState.DENIED);
    await recordApproval(appStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('runs the tool when both stores approve it', async () => {
    await recordApproval(serverStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);
    await recordApproval(appStorage, BETA_DEPLOY_ID, ApprovalState.APPROVED);

    const result = await callTool(server, 'beta_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['beta']);
  });
});
