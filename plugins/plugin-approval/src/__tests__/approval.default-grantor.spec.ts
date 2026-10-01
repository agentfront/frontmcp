/**
 * A grant made through `this.approval` records the caller who made it (#647).
 *
 * The service defaulted `grantedBy` to `'policy'`, so an audit trail showed every approval a
 * user gave from inside a tool as granted by a policy.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

const DEPLOY_TOOL_ID = 'ops:deploy_service';

@Tool({ name: 'deploy_service', description: 'Deploys a service', inputSchema: {}, approval: { required: true } })
class DeployServiceTool extends ToolContext {
  async execute() {
    return { deployed: true };
  }
}

@Tool({ name: 'approve_deploy', description: 'Approves deploying for this session', inputSchema: {} })
class ApproveDeployTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(DEPLOY_TOOL_ID);
    const stored = await this.approval.getApproval(DEPLOY_TOOL_ID);
    return { grantedBy: stored?.grantedBy ?? null };
  }
}

@App({ id: 'ops', name: 'Ops', plugins: [ApprovalPlugin.init({})], tools: [DeployServiceTool, ApproveDeployTool] })
class OpsApp {}

describe('this.approval grants — the recorded grantor (#647)', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-default-grantor', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('records the signed-in user who granted the approval', async () => {
    const result = await server.callTool('approve_deploy', {}, { authContext: { user: { sub: 'alice' } } });

    expect(result.structuredContent).toEqual({
      grantedBy: { source: 'user', identifier: 'alice', method: 'implicit' },
    });
  });

  it('keeps an explicit grantor as given, so an approval the user answered stays interactive', async () => {
    const { ApprovalService, ApprovalStorageStore, userGrantor } = await import('../index');
    const storage = createMemoryStorage();
    await storage.connect();
    const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
    const service = new ApprovalService(store, 'session-1', 'alice');

    const implicit = await service.grantSessionApproval(DEPLOY_TOOL_ID);
    const answered = await service.grantUserApproval(DEPLOY_TOOL_ID, { grantedBy: userGrantor('alice') });
    await store.close();

    expect(implicit.grantedBy.method).toBe('implicit');
    expect(answered.grantedBy.method).toBe('interactive');
  });

  it('records no interactive method for a grant without a signed-in user', async () => {
    const { ApprovalService, ApprovalStorageStore } = await import('../index');
    const storage = createMemoryStorage();
    await storage.connect();
    const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
    const record = await new ApprovalService(store, 'session-1').grantSessionApproval(DEPLOY_TOOL_ID);
    await store.close();

    expect(record.grantedBy).toEqual({ source: 'user', method: 'implicit' });
  });
});
