/** `mode: 'recheck'` with `recheck.url`: a call without an approval polls the approval system until it decides. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
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
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalRequiredError } from '../approval';
import ApprovalPlugin, { type ApprovalPluginOptions } from '../approval.plugin';
import { checkSignature, signingKeyOf } from '../external/webhook-signature';
import { ApprovalStorageStore } from '../stores';
import { ApprovalScope, ApprovalState } from '../types';
import { json, startApprovalReceiver, type ApprovalReceiver } from './helpers/approval-receiver';

const DEPLOY_TOOL_ID = 'ops:deploy_service';
const ALICE: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' }, token: 'alice-access-token' };

const deployed: string[] = [];

@Tool({
  name: 'deploy_service',
  description: 'Deploys a service',
  inputSchema: { service: z.string() },
  approval: { required: true, allowedScopes: [ApprovalScope.SESSION, ApprovalScope.TIME_LIMITED] },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    deployed.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({ name: 'wipe_disk', description: 'Wipes a disk', inputSchema: {}, approval: { alwaysPrompt: true } })
class WipeDiskTool extends ToolContext {
  async execute() {
    deployed.push('wipe');
    return { wiped: true };
  }
}

const auditRecords: LogRecord[] = [];

@LogTransport({ name: 'RecheckAuditCapture', description: 'Keeps audit lines for assertions' })
class AuditCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.message.startsWith('approval.')) auditRecords.push(record);
  }
}

let receiver: ApprovalReceiver;
let storage: RootStorage;
let server: DirectMcpServer;

async function startServer(recheck: Partial<NonNullable<ApprovalPluginOptions['recheck']>> = {}, enableAudit = false) {
  @App({
    id: 'ops',
    name: 'Ops',
    plugins: [
      ApprovalPlugin.init({
        storageInstance: storage,
        enableAudit,
        recheck: { url: receiver.url, interval: 100, ...recheck },
      }),
    ],
    tools: [DeployServiceTool, WipeDiskTool],
  })
  class OpsApp {}

  server = await FrontMcpInstance.createDirect({
    info: { name: 'approval-recheck', version: '1.0.0' },
    apps: [OpsApp],
    logging: { level: LogLevel.Info, enableConsole: false, transports: [AuditCapture] },
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}, authContext: DirectAuthContext = ALICE) {
  try {
    return await server.callTool(name, args, { authContext });
  } catch (error) {
    return error;
  }
}

function refusalState(result: unknown): string | undefined {
  return result instanceof ApprovalRequiredError ? result.details.state : undefined;
}

async function storedApprovals() {
  const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
  await store.initialize();
  return store.getApprovals(DEPLOY_TOOL_ID, 'session-alice', 'alice');
}

const pending = json(200, { approved: false, pending: true });

beforeEach(async () => {
  deployed.length = 0;
  auditRecords.length = 0;
  receiver = await startApprovalReceiver('/status');
  storage = createMemoryStorage();
  await storage.connect();
});

afterEach(async () => {
  await server?.dispose();
  await receiver.close();
});

describe('ApprovalPlugin recheck mode', () => {
  it('runs the call when the first poll approves it, and records the approval', async () => {
    receiver.answerWith(json(200, { approved: true, grantedBy: { source: 'admin', identifier: 'ops-lead' } }));
    await startServer();

    expect(await callTool('deploy_service', { service: 'api' })).toMatchObject({
      structuredContent: { deployed: 'api' },
    });
    expect(await callTool('deploy_service', { service: 'web' })).toMatchObject({
      structuredContent: { deployed: 'web' },
    });

    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0].json).toEqual({
      type: 'approval.status',
      requestId: expect.stringMatching(/^[0-9a-f]{64}$/),
      attempt: 1,
      toolId: DEPLOY_TOOL_ID,
      toolName: 'deploy_service',
      requestedScope: 'session',
      allowedScopes: ['session', 'time_limited'],
      userId: 'alice',
      timestamp: expect.any(Number),
    });
    expect(receiver.requests[0].body).not.toContain('session-alice');
    expect(await storedApprovals()).toEqual([
      expect.objectContaining({
        state: ApprovalState.APPROVED,
        scope: ApprovalScope.SESSION,
        grantedBy: { source: 'admin', identifier: 'ops-lead', origin: 'recheck' },
      }),
    ]);
  });

  it('polls every interval while the answer is pending', async () => {
    receiver.answerWith(pending, pending, json(200, { approved: true, scope: 'time_limited', ttlMs: 60_000 }));
    await startServer();

    const startedAt = Date.now();
    expect(await callTool('deploy_service', { service: 'api' })).toMatchObject({
      structuredContent: { deployed: 'api' },
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
    expect(receiver.requests.map((request) => request.json['attempt'])).toEqual([1, 2, 3]);
    expect(new Set(receiver.requests.map((request) => request.json['requestId'])).size).toBe(1);
    expect(await storedApprovals()).toEqual([
      expect.objectContaining({ scope: ApprovalScope.TIME_LIMITED, ttlMs: 60_000 }),
    ]);
  });

  it('refuses the call as pending after maxAttempts pending answers', async () => {
    receiver.answerWith(pending);
    await startServer({ maxAttempts: 3 });

    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('pending');
    expect(receiver.requests).toHaveLength(3);
    expect(deployed).toEqual([]);
  });

  it('refuses the call as denied, records nothing, and asks again on the next call', async () => {
    receiver.answerWith(json(200, { approved: false, denialReason: 'change freeze' }));
    await startServer();

    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('denied');
    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('denied');

    expect(receiver.requests).toHaveLength(2);
    expect(await storedApprovals()).toEqual([]);
  });

  it('lets an alwaysPrompt call through once, recording nothing', async () => {
    receiver.answerWith(json(200, { approved: true }));
    await startServer();

    expect(await callTool('wipe_disk')).toMatchObject({ structuredContent: { wiped: true } });
    expect(await callTool('wipe_disk')).toMatchObject({ structuredContent: { wiped: true } });

    expect(receiver.requests).toHaveLength(2);
  });

  it('refuses an approval the tool policy does not allow', async () => {
    receiver.answerWith(json(200, { approved: true, scope: 'user' }));
    await startServer();

    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('pending');
    expect(await storedApprovals()).toEqual([]);
  });

  it.each<[string, Parameters<ApprovalReceiver['answerWith']>[0]]>([
    ['an error status', json(503, { approved: true })],
    ['a body that is not JSON', (_request, response) => response.end('approved')],
    ['an answer without approved', json(200, { pending: true })],
    [
      'a redirect',
      (_request, response) => {
        response.writeHead(302, { location: '/elsewhere' });
        response.end();
      },
    ],
  ])('refuses the call as pending, without polling again, for %s', async (_, answer) => {
    receiver.answerWith(answer);
    await startServer();

    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('pending');
    expect(receiver.requests).toHaveLength(1);
  });

  it('sends no Authorization header with auth: none', async () => {
    receiver.answerWith(json(200, { approved: true }));
    await startServer();

    await callTool('deploy_service', { service: 'api' });

    expect(receiver.requests[0].headers['authorization']).toBeUndefined();
    expect(receiver.requests[0].headers['webhook-signature']).toBeUndefined();
  });

  it('sends the configured token with auth: bearer', async () => {
    receiver.answerWith(json(200, { approved: true }));
    await startServer({ auth: 'bearer', token: 'recheck-service-token' });

    await callTool('deploy_service', { service: 'api' });

    expect(receiver.requests[0].headers['authorization']).toBe('Bearer recheck-service-token');
  });

  it("forwards the caller's token with auth: jwt, and polls nothing for a call without one", async () => {
    receiver.answerWith(json(200, { approved: true }));
    await startServer({ auth: 'jwt' });

    expect(
      refusalState(await callTool('deploy_service', { service: 'api' }, { sessionId: 's-2', user: { sub: 'bob' } })),
    ).toBe('pending');
    expect(receiver.requests).toHaveLength(0);

    await callTool('deploy_service', { service: 'api' });
    expect(receiver.requests[0].headers['authorization']).toBe('Bearer alice-access-token');
  });

  it('sends the headers of auth: custom, for the poll', async () => {
    receiver.answerWith(json(200, { approved: true }));
    const headers = jest.fn(async (request: { toolId: string }) => ({ 'x-approval-tool': request.toolId }));
    await startServer({ auth: 'custom', headers });

    await callTool('deploy_service', { service: 'api' });

    expect(headers).toHaveBeenCalledWith(expect.objectContaining({ toolId: DEPLOY_TOOL_ID, attempt: 1 }));
    expect(receiver.requests[0].headers['x-approval-tool']).toBe(DEPLOY_TOOL_ID);
  });

  it('signs each poll with recheck.secret', async () => {
    const secret = 'a-recheck-secret-of-at-least-32-chars';
    receiver.answerWith(json(200, { approved: true }));
    await startServer({ secret });

    await callTool('deploy_service', { service: 'api' });

    const [poll] = receiver.requests;
    expect(
      checkSignature(signingKeyOf(secret), {
        id: poll.headers['webhook-id'] as string,
        timestamp: poll.headers['webhook-timestamp'] as string,
        signature: poll.headers['webhook-signature'] as string,
        body: poll.body,
      }),
    ).toBe('valid');
  });

  it('polls nothing for a call a recorded denial refuses', async () => {
    const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
    await store.denyApproval({ toolId: DEPLOY_TOOL_ID, scope: ApprovalScope.SESSION, sessionId: 'session-alice' });
    await startServer();

    expect(refusalState(await callTool('deploy_service', { service: 'api' }))).toBe('denied');
    expect(receiver.requests).toHaveLength(0);
  });

  it('names the recheck system in the audit trail', async () => {
    receiver.answerWith(pending, json(200, { approved: true }));
    await startServer({ maxAttempts: 1 }, true);

    await callTool('deploy_service', { service: 'api' });
    await callTool('deploy_service', { service: 'api' });

    expect(auditRecords.map((record) => record.args[0])).toEqual([
      expect.objectContaining({ type: 'approval.requested', state: 'pending', via: 'recheck' }),
      expect.objectContaining({
        type: 'approval.granted',
        grantedBy: { source: 'api', method: 'api', origin: 'recheck' },
      }),
      expect.objectContaining({ type: 'approval.requested', state: 'approved', via: 'recheck' }),
    ]);
  });
});
