/**
 * Two apps on one server, each installing `ApprovalPlugin.init()` with its own store.
 *
 * Each app's approval gate must judge only that app's tools against that app's store: one app's
 * gate must not refuse the other app's tools, and one app's pass must not skip the other's check.
 * `this.approval` inside an app's tools must read and write that app's store (#600).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
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

const toolIdInput = { toolId: z.string() };

@Tool({ name: 'alpha_grant', inputSchema: toolIdInput })
class AlphaGrantTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    await this.approval.grantSessionApproval(toolId);
    return { granted: toolId };
  }
}

@Tool({ name: 'alpha_is_approved', inputSchema: toolIdInput })
class AlphaIsApprovedTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    return { approved: await this.approval.isApproved(toolId) };
  }
}

@Tool({ name: 'beta_grant', inputSchema: toolIdInput })
class BetaGrantTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    await this.approval.grantSessionApproval(toolId);
    return { granted: toolId };
  }
}

@Tool({ name: 'beta_is_approved', inputSchema: toolIdInput })
class BetaIsApprovedTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    return { approved: await this.approval.isApproved(toolId) };
  }
}

@Tool({ name: 'server_grant', inputSchema: toolIdInput })
class ServerGrantTool extends ToolContext {
  async execute({ toolId }: { toolId: string }) {
    await this.approval.grantSessionApproval(toolId);
    return { granted: toolId };
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

/** Grants through `this.approval` inside a tool, so the grant lands in the store of that tool's plugin. */
async function grantThrough(server: DirectMcpServer, grantTool: string, toolId: string): Promise<void> {
  const result = await server.callTool(grantTool, { toolId }, { authContext: CALLER });
  expect(result.isError).toBeFalsy();
}

async function isApprovedThrough(server: DirectMcpServer, checkTool: string, toolId: string): Promise<boolean> {
  const result = await server.callTool(checkTool, { toolId }, { authContext: CALLER });
  return (result.structuredContent as { approved: boolean }).approved;
}

async function storedKeys(storage: RootStorage): Promise<string[]> {
  return storage.keys('*');
}

// `ApprovalService` has no deny API; a denial is written to the store the way an administrator records one.
async function recordDenial(storage: RootStorage, toolId: string): Promise<void> {
  const record = {
    toolId,
    state: ApprovalState.DENIED,
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
      tools: [AlphaDeployTool, AlphaGrantTool, AlphaIsApprovedTool],
    })
    class AlphaApp {}

    @App({
      id: 'beta',
      name: 'Beta',
      plugins: [ApprovalPlugin.init({ storageInstance: betaStorage })],
      tools: [BetaDeployTool, BetaGrantTool, BetaIsApprovedTool],
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
    await grantThrough(server, 'beta_grant', BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['beta']);
  });

  it('runs the first app tool once the first app store approves it', async () => {
    await grantThrough(server, 'alpha_grant', ALPHA_DEPLOY_ID);

    const result = await callTool(server, 'alpha_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['alpha']);
  });

  it('does not let an approval in the first app store admit the second app tool', async () => {
    await grantThrough(server, 'alpha_grant', BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('keeps a denial recorded in the second app store when the first app store approves', async () => {
    await grantThrough(server, 'alpha_grant', BETA_DEPLOY_ID);
    await recordDenial(betaStorage, BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect((result as ApprovalRequiredError).details.state).toBe('denied');
    expect(executedDeployments).toEqual([]);
  });

  it('writes a grant made through this.approval in the first app tool to the first app store only', async () => {
    await grantThrough(server, 'alpha_grant', ALPHA_DEPLOY_ID);

    expect(await storedKeys(alphaStorage)).toEqual(expect.arrayContaining([expect.stringContaining(ALPHA_DEPLOY_ID)]));
    expect(await storedKeys(betaStorage)).toEqual([]);
  });

  it('writes a grant made through this.approval in the second app tool to the second app store only', async () => {
    await grantThrough(server, 'beta_grant', BETA_DEPLOY_ID);

    expect(await storedKeys(betaStorage)).toEqual(expect.arrayContaining([expect.stringContaining(BETA_DEPLOY_ID)]));
    expect(await storedKeys(alphaStorage)).toEqual([]);
  });

  it('reads through this.approval only the store of the app the tool belongs to', async () => {
    await grantThrough(server, 'alpha_grant', BETA_DEPLOY_ID);

    await expect(isApprovedThrough(server, 'alpha_is_approved', BETA_DEPLOY_ID)).resolves.toBe(true);
    await expect(isApprovedThrough(server, 'beta_is_approved', BETA_DEPLOY_ID)).resolves.toBe(false);
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
      tools: [BetaDeployTool, BetaGrantTool],
    })
    class BetaApp {}

    @Plugin({
      name: 'server-approvals',
      plugins: [ApprovalPlugin.init({ storageInstance: serverStorage })],
      tools: [ServerGrantTool],
    })
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
    await grantThrough(server, 'server_grant', BETA_DEPLOY_ID);
    await recordDenial(appStorage, BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('keeps the server store denial when the app store approves', async () => {
    await recordDenial(serverStorage, BETA_DEPLOY_ID);
    await grantThrough(server, 'beta_grant', BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).toBeInstanceOf(ApprovalRequiredError);
    expect(executedDeployments).toEqual([]);
  });

  it('runs the tool when both stores approve it', async () => {
    await grantThrough(server, 'server_grant', BETA_DEPLOY_ID);
    await grantThrough(server, 'beta_grant', BETA_DEPLOY_ID);

    const result = await callTool(server, 'beta_deploy');

    expect(result).not.toBeInstanceOf(Error);
    expect(executedDeployments).toEqual(['beta']);
  });

  it('writes a grant made through this.approval in a server plugin tool to the server store only', async () => {
    await grantThrough(server, 'server_grant', BETA_DEPLOY_ID);

    expect(await storedKeys(serverStorage)).toEqual(expect.arrayContaining([expect.stringContaining(BETA_DEPLOY_ID)]));
    expect(await storedKeys(appStorage)).toEqual([]);
  });

  it('writes a grant made through this.approval in the app tool to the app store only', async () => {
    await grantThrough(server, 'beta_grant', BETA_DEPLOY_ID);

    expect(await storedKeys(appStorage)).toEqual(expect.arrayContaining([expect.stringContaining(BETA_DEPLOY_ID)]));
    expect(await storedKeys(serverStorage)).toEqual([]);
  });
});
