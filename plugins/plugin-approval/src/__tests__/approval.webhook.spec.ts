/**
 * `mode: 'webhook'` with `webhook.url`: a refused call sends a signed request to the approval system, and its signed
 * decision on the callback route grants or denies. Two servers share one storage, as two nodes would: tools are called
 * on one, and decisions arrive on the other's HTTP callback route.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalConfigurationError, ApprovalRequiredError } from '../approval';
import ApprovalPlugin, { type ApprovalPluginOptions } from '../approval.plugin';
import { checkSignature, signatureHeaders, signingKeyOf } from '../external/webhook-signature';
import { ApprovalStorageStore } from '../stores';
import { ApprovalScope, ApprovalState, type WebhookPayload } from '../types';
import { json, startApprovalReceiver, type ApprovalReceiver } from './helpers/approval-receiver';

const SECRET = 'a-webhook-secret-of-at-least-32-chars';
const signingKey = signingKeyOf(SECRET);
const DEPLOY_TOOL_ID = 'ops:deploy_service';
const ALICE: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' }, token: 'alice-access-token' };
const BOB: DirectAuthContext = { sessionId: 'session-bob', user: { sub: 'bob' } };

const deployed: string[] = [];

@Tool({
  name: 'deploy_service',
  description: 'Deploys a service',
  inputSchema: { service: z.string() },
  approval: { required: true, category: 'execute', riskLevel: 'high', approvalMessage: 'Deploy?' },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    deployed.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({
  name: 'rotate_keys',
  description: 'Rotates keys',
  inputSchema: {},
  approval: { required: true, allowedScopes: [ApprovalScope.SESSION], maxTtlMs: 60_000 },
})
class RotateKeysTool extends ToolContext {
  async execute() {
    return { rotated: true };
  }
}

function opsApp(options: ApprovalPluginOptions) {
  @App({ id: 'ops', name: 'Ops', plugins: [ApprovalPlugin.init(options)], tools: [DeployServiceTool, RotateKeysTool] })
  class OpsApp {}
  return OpsApp;
}

let receiver: ApprovalReceiver;
let storage: RootStorage;
let toolServer: DirectMcpServer;
let callbackServer: (request: Request) => Promise<Response>;

async function startServers(webhook: Partial<NonNullable<ApprovalPluginOptions['webhook']>> = {}) {
  const options: ApprovalPluginOptions = {
    storageInstance: storage,
    mode: 'webhook',
    webhook: { url: receiver.url, secret: SECRET, challengeTtl: 60, ...webhook },
  };
  toolServer = await FrontMcpInstance.createDirect({
    info: { name: 'approval-webhook-tools', version: '1.0.0' },
    apps: [opsApp(options)],
    logging: { level: LogLevel.Off },
  });
  callbackServer = await FrontMcpInstance.createFetchHandler({
    info: { name: 'approval-webhook-callbacks', version: '1.0.0' },
    apps: [opsApp(options)],
    logging: { level: LogLevel.Off },
  });
}

async function callTool(name: string, args: Record<string, unknown>, authContext: DirectAuthContext) {
  try {
    return await toolServer.callTool(name, args, { authContext });
  } catch (error) {
    return error;
  }
}

function requestPayload(index = 0): WebhookPayload {
  return receiver.requests[index].json as unknown as WebhookPayload;
}

function callback(decision: Record<string, unknown>, headers?: Record<string, string>, path = '/approval/callback') {
  const body = JSON.stringify(decision);
  return callbackServer(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? signatureHeaders(signingKey, body)) },
      body,
    }),
  );
}

/** The approvals in the shared storage, read as a third node would. */
async function approvalStore(): Promise<ApprovalStorageStore> {
  const store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
  await store.initialize();
  return store;
}

beforeEach(async () => {
  deployed.length = 0;
  receiver = await startApprovalReceiver();
  storage = createMemoryStorage();
  await storage.connect();
});

afterEach(async () => {
  await toolServer?.dispose();
  await receiver.close();
});

describe('ApprovalPlugin webhook mode', () => {
  it('sends one signed request for a refused call, and none for the next while it is pending', async () => {
    await startServers();

    const first = await callTool('deploy_service', { service: 'api' }, ALICE);
    const second = await callTool('deploy_service', { service: 'api' }, ALICE);

    expect(first).toBeInstanceOf(ApprovalRequiredError);
    expect((second as ApprovalRequiredError).details.state).toBe('pending');
    expect(receiver.requests).toHaveLength(1);
    const [request] = receiver.requests;
    expect(
      checkSignature(signingKey, {
        id: request.headers['webhook-id'] as string,
        timestamp: request.headers['webhook-timestamp'] as string,
        signature: request.headers['webhook-signature'] as string,
        body: request.body,
      }),
    ).toBe('valid');
    expect(requestPayload()).toEqual({
      type: 'approval.requested',
      codeChallenge: expect.any(String),
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9._~-]{43,128}$/),
      toolId: DEPLOY_TOOL_ID,
      toolName: 'deploy_service',
      category: 'execute',
      riskLevel: 'high',
      approvalMessage: 'Deploy?',
      requestedScope: 'session',
      userId: 'alice',
      callbackPath: '/approval/callback',
      expiresAt: expect.any(Number),
      timestamp: expect.any(Number),
    });
    expect(request.body).not.toContain('session-alice');
    expect(request.body).not.toContain('alice-access-token');
    expect(deployed).toEqual([]);
  });

  it('sends a request per caller', async () => {
    await startServers();

    await callTool('deploy_service', { service: 'api' }, ALICE);
    await callTool('deploy_service', { service: 'api' }, BOB);

    expect(receiver.requests.map((request) => request.json['userId'])).toEqual(['alice', 'bob']);
  });

  it("forwards the caller's token only with includeJwt: true", async () => {
    await startServers({ includeJwt: true });

    await callTool('deploy_service', { service: 'api' }, ALICE);

    expect(requestPayload().jwt).toBe('alice-access-token');
  });

  it('names the callback URL when FRONTMCP_PUBLIC_URL is set', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com/';
    try {
      await startServers({ callbackPath: '/hooks/approvals' });
      await callTool('deploy_service', { service: 'api' }, ALICE);
    } finally {
      delete process.env['FRONTMCP_PUBLIC_URL'];
    }

    expect(requestPayload()).toMatchObject({
      callbackPath: '/hooks/approvals',
      callbackUrl: 'https://mcp.example.com/hooks/approvals',
    });
  });

  it('runs the call once the approval system approves it', async () => {
    await startServers();
    await callTool('deploy_service', { service: 'api' }, ALICE);

    const response = await callback({
      codeVerifier: requestPayload().codeVerifier,
      approved: true,
      grantedBy: { source: 'user', identifier: 'lead-1', displayName: 'Lead' },
      reason: 'looks fine',
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'received' });
    expect(await callTool('deploy_service', { service: 'api' }, ALICE)).toMatchObject({
      structuredContent: { deployed: 'api' },
    });
    expect(await callTool('deploy_service', { service: 'web' }, BOB)).toBeInstanceOf(ApprovalRequiredError);
    const [record] = (await (await approvalStore()).getApprovals?.(DEPLOY_TOOL_ID, 'session-alice', 'alice')) ?? [];
    expect(record).toMatchObject({
      state: ApprovalState.APPROVED,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-alice',
      grantedBy: { source: 'user', identifier: 'lead-1', displayName: 'Lead', origin: 'webhook' },
      reason: 'looks fine',
    });
  });

  it('grants the scope and lifetime the decision names, within the tool policy', async () => {
    await startServers();
    await callTool('deploy_service', { service: 'api' }, ALICE);

    await callback({ codeVerifier: requestPayload().codeVerifier, approved: true, scope: 'user', ttlMs: 30_000 });

    const records = (await (await approvalStore()).getApprovals?.(DEPLOY_TOOL_ID, 'another-session', 'alice')) ?? [];
    expect(records).toEqual([
      expect.objectContaining({
        scope: ApprovalScope.USER,
        userId: 'alice',
        ttlMs: 30_000,
        grantedBy: { source: 'api', method: 'api', origin: 'webhook' },
      }),
    ]);
  });

  it('records nothing for a decision the tool policy refuses, and asks again on the next call', async () => {
    await startServers();
    await callTool('rotate_keys', {}, ALICE);

    await callback({ codeVerifier: requestPayload().codeVerifier, approved: true, scope: 'user' });

    expect(await callTool('rotate_keys', {}, ALICE)).toBeInstanceOf(ApprovalRequiredError);
    expect(receiver.requests).toHaveLength(2);
  });

  it('refuses the calls as denied once the approval system denies, for challengeTtl', async () => {
    await startServers();
    await callTool('deploy_service', { service: 'api' }, ALICE);

    await callback({ codeVerifier: requestPayload().codeVerifier, approved: false, reason: 'not today' });

    const refused = await callTool('deploy_service', { service: 'api' }, ALICE);
    expect((refused as ApprovalRequiredError).details.state).toBe('denied');
    expect(receiver.requests).toHaveLength(1);
    const [denial] = (await (await approvalStore()).getApprovals?.(DEPLOY_TOOL_ID, 'session-alice', 'alice')) ?? [];
    expect(denial).toMatchObject({ state: ApprovalState.DENIED, ttlMs: 60_000, reason: 'not today' });
  });

  it('does nothing for a replayed decision', async () => {
    await startServers();
    await callTool('deploy_service', { service: 'api' }, ALICE);
    const decision = { codeVerifier: requestPayload().codeVerifier, approved: true };
    const body = JSON.stringify(decision);
    const headers = signatureHeaders(signingKey, body);
    await callback(decision, headers);
    await (
      await approvalStore()
    ).revokeApproval({ toolId: DEPLOY_TOOL_ID, sessionId: 'session-alice', userId: 'alice' });

    const replay = await callback(decision, headers);

    expect(replay.status).toBe(202);
    expect(await callTool('deploy_service', { service: 'api' }, ALICE)).toBeInstanceOf(ApprovalRequiredError);
  });

  it('does nothing for a decision after challengeTtl', async () => {
    await startServers({ challengeTtl: 1 });
    await callTool('deploy_service', { service: 'api' }, ALICE);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const late = await callback({ codeVerifier: requestPayload().codeVerifier, approved: true });

    expect(late.status).toBe(202);
    expect(await callTool('deploy_service', { service: 'api' }, ALICE)).toBeInstanceOf(ApprovalRequiredError);
  });

  it('answers a decision for an unknown request as it answers any other', async () => {
    await startServers();

    const response = await callback({ codeVerifier: 'x'.repeat(43), approved: true });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'received' });
  });

  it.each<[string, (body: string) => Record<string, string>]>([
    ['unsigned', () => ({})],
    [
      'signed with another secret',
      (body) => signatureHeaders(signingKeyOf('another-secret-of-at-least-32-chars'), body),
    ],
    ['signed six minutes ago', (body) => signatureHeaders(signingKey, body, Date.now() - 360_000)],
    [
      'signed for another body',
      (body) => signatureHeaders(signingKey, body.replace('"approved":true', '"approved":false')),
    ],
  ])('refuses a decision %s', async (_, sign) => {
    await startServers();
    await callTool('deploy_service', { service: 'api' }, ALICE);
    const decision = { codeVerifier: requestPayload().codeVerifier, approved: true };

    const response = await callback(decision, sign(JSON.stringify(decision)));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_signature' });
    expect(await callTool('deploy_service', { service: 'api' }, ALICE)).toBeInstanceOf(ApprovalRequiredError);
  });

  it('refuses a body that is not a decision, or too large', async () => {
    await startServers();

    const malformed = await callback({ approved: true });
    const oversized = await callback({ codeVerifier: 'x'.repeat(43), approved: true, reason: 'x'.repeat(17_000) });
    const empty = await callbackServer(new Request('http://localhost/approval/callback', { method: 'POST' }));

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(empty.status).toBe(400);
  });

  it('asks again after a request the approval system did not take', async () => {
    receiver.answerWith(json(500, { error: 'down' }), json(200, {}));
    await startServers();

    await callTool('deploy_service', { service: 'api' }, ALICE);
    await callTool('deploy_service', { service: 'api' }, ALICE);
    await callTool('deploy_service', { service: 'api' }, ALICE);

    expect(receiver.requests).toHaveLength(2);
  });

  it('serves the callback route on the configured path only', async () => {
    await startServers({ callbackPath: '/hooks/approvals' });

    expect((await callback({ codeVerifier: 'x'.repeat(43), approved: true })).status).toBe(404);
    expect(
      (await callback({ codeVerifier: 'x'.repeat(43), approved: true }, undefined, '/hooks/approvals')).status,
    ).toBe(202);
  });

  it('serves no callback route without webhook.url', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'approval-webhook-off', version: '1.0.0' },
      apps: [opsApp({ storageInstance: storage, mode: 'webhook', webhook: { challengeTtl: 60 } })],
      logging: { level: LogLevel.Off },
    });

    const response = await handler(
      new Request('http://localhost/approval/callback', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('refuses to start with a callback path the server reserves', async () => {
    await expect(
      FrontMcpInstance.createFetchHandler({
        info: { name: 'approval-webhook-reserved', version: '1.0.0' },
        apps: [
          opsApp({
            storageInstance: storage,
            mode: 'webhook',
            webhook: { url: receiver.url, secret: SECRET, callbackPath: '/oauth/approval' },
          }),
        ],
        logging: { level: LogLevel.Off },
      }),
    ).rejects.toThrow(ApprovalConfigurationError);
  });
});
