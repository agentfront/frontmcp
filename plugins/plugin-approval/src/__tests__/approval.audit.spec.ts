/** `enableAudit`: one line in the server's log per request, grant, denial, revocation and expiry. */
import 'reflect-metadata';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
  type LogRecord,
} from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalRequiredError, userGrantor, userRevoker } from '../approval';
import ApprovalPlugin from '../approval.plugin';
import { ApprovalStoreToken } from '../approval.symbols';
import type { ApprovalAuditEvent } from '../audit/approval-audit';
import { ApprovalScope } from '../types';

const TOOL_ID = 'ops:deploy';
const CALLER: DirectAuthContext = { sessionId: 'session-secret-1', user: { sub: 'alice' }, token: 'alice-token' };

const records: LogRecord[] = [];

@LogTransport({ name: 'AuditCapture', description: 'Keeps log records for assertions' })
class AuditCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    records.push(record);
  }
}

@Tool({ name: 'deploy', description: 'Deploys', inputSchema: {}, approval: true })
class DeployTool extends ToolContext {
  async execute() {
    return { deployed: true };
  }
}

@Tool({ name: 'approve', description: 'Approves deploy', inputSchema: {} })
class ApproveTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(TOOL_ID, { grantedBy: userGrantor('lead'), reason: 'on call' });
    return { ok: true };
  }
}

@Tool({ name: 'approve_briefly', description: 'Approves deploy for a moment', inputSchema: {} })
class ApproveBrieflyTool extends ToolContext {
  async execute() {
    await this.approval.grantTimeLimitedApproval(TOOL_ID, 1);
    return { ok: true };
  }
}

@Tool({ name: 'revoke', description: 'Revokes deploy', inputSchema: {} })
class RevokeTool extends ToolContext {
  async execute() {
    await this.approval.revokeApproval(TOOL_ID, { revokedBy: userRevoker('lead'), reason: 'shift over' });
    return { ok: true };
  }
}

@Tool({ name: 'deny', description: 'Denies deploy', inputSchema: {} })
class DenyTool extends ToolContext {
  async execute() {
    await this.get(ApprovalStoreToken).denyApproval?.({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-secret-1',
      grantedBy: userGrantor('lead'),
      reason: 'freeze',
    });
    return { ok: true };
  }
}

@Tool({ name: 'clean_up', description: 'Deletes expired approvals', inputSchema: {} })
class CleanUpTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { deleted: await this.get(ApprovalStoreToken).clearExpiredApprovals() };
  }
}

@Tool({ name: 'clear_session', description: 'Clears the session approvals', inputSchema: {} })
class ClearSessionTool extends ToolContext {
  async execute() {
    return { cleared: await this.approval.clearSessionApprovals() };
  }
}

let server: DirectMcpServer;

async function start(enableAudit?: boolean) {
  const storage = createMemoryStorage();
  await storage.connect();
  @App({
    id: 'ops',
    name: 'Ops',
    plugins: [ApprovalPlugin.init({ storageInstance: storage, cleanupIntervalSeconds: 0, enableAudit })],
    tools: [DeployTool, ApproveTool, ApproveBrieflyTool, RevokeTool, DenyTool, CleanUpTool, ClearSessionTool],
  })
  class OpsApp {}
  server = await FrontMcpInstance.createDirect({
    info: { name: 'approval-audit', version: '1.0.0' },
    apps: [OpsApp],
    logging: { level: LogLevel.Info, enableConsole: false, transports: [AuditCapture] },
  });
}

async function call(name: string) {
  try {
    return await server.callTool(name, {}, { authContext: CALLER });
  } catch (error) {
    return error;
  }
}

function auditLines(): Array<{ message: string; event: ApprovalAuditEvent }> {
  return records
    .filter((record) => record.message.startsWith('approval.'))
    .map((record) => ({ message: record.message, event: record.args[0] as ApprovalAuditEvent }));
}

beforeEach(() => {
  records.length = 0;
});

afterEach(async () => {
  await server.dispose();
});

describe('ApprovalPlugin enableAudit', () => {
  it('logs each request, grant, denial, revocation and expiry', async () => {
    await start(true);

    expect(await call('deploy')).toBeInstanceOf(ApprovalRequiredError);
    await call('approve');
    await call('deploy');
    await call('revoke');
    await call('deny');
    expect(await call('deploy')).toBeInstanceOf(ApprovalRequiredError);
    await call('clear_session');
    await call('approve_briefly');
    await call('clean_up');

    const lines = auditLines();
    expect(lines.map((line) => line.message)).toEqual([
      `approval.requested ${TOOL_ID}`,
      `approval.granted ${TOOL_ID}`,
      `approval.revoked ${TOOL_ID}`,
      `approval.denied ${TOOL_ID}`,
      `approval.requested ${TOOL_ID}`,
      'approval.revoked',
      `approval.granted ${TOOL_ID}`,
      `approval.expired ${TOOL_ID}`,
    ]);
    expect(lines.map((line) => line.event)).toEqual([
      { type: 'approval.requested', toolId: TOOL_ID, userId: 'alice', state: 'pending' },
      {
        type: 'approval.granted',
        toolId: TOOL_ID,
        scope: 'session',
        grantedBy: { source: 'user', identifier: 'lead', method: 'interactive' },
        reason: 'on call',
      },
      expect.objectContaining({
        type: 'approval.revoked',
        toolId: TOOL_ID,
        revokedBy: { source: 'user', identifier: 'lead', method: 'interactive' },
        reason: 'shift over',
      }),
      expect.objectContaining({ type: 'approval.denied', toolId: TOOL_ID, scope: 'session', reason: 'freeze' }),
      { type: 'approval.requested', toolId: TOOL_ID, userId: 'alice', state: 'denied' },
      { type: 'approval.revoked', count: 1, reason: 'session approvals cleared' },
      expect.objectContaining({
        type: 'approval.granted',
        scope: 'time_limited',
        userId: 'alice',
        expiresAt: expect.any(Number),
      }),
      expect.objectContaining({ type: 'approval.expired', scope: 'time_limited', userId: 'alice' }),
    ]);
    const logged = JSON.stringify(records.filter((record) => record.message.startsWith('approval.')));
    expect(logged).not.toContain('session-secret-1');
    expect(logged).not.toContain('alice-token');
  });

  it('logs nothing without enableAudit', async () => {
    await start();

    await call('deploy');
    await call('approve');
    await call('revoke');

    expect(auditLines()).toEqual([]);
  });
});
