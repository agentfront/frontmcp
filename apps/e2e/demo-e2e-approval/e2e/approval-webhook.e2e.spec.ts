/**
 * `mode: 'webhook'` over real HTTP: a refused call sends a signed approval request, and a signed decision on
 * `/approval/callback` lets the next call run. The server's own `/test/approval-inbox` route stands in for the
 * approval system.
 */
import { expect, test } from '@frontmcp/testing';
import { base64Encode, hmacSha256, randomUUID } from '@frontmcp/utils';

const SECRET = 'demo-e2e-approval-webhook-secret-0123';
const encoder = new TextEncoder();

interface ReceivedApprovalRequest {
  headers: Record<string, string>;
  body: string;
}

function sign(id: string, timestamp: string, body: string): string {
  return `v1,${base64Encode(hmacSha256(encoder.encode(SECRET), encoder.encode(`${id}.${timestamp}.${body}`)))}`;
}

function signedHeaders(body: string): Record<string, string> {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': sign(id, timestamp, body) };
}

test.describe('Approval webhook mode', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-approval/src/main-webhook.ts',
    project: 'demo-e2e-approval',
    publicMode: true,
    env: { APPROVAL_WEBHOOK_SECRET: SECRET },
  });

  test('a signed decision on the callback route lets the refused call run', async ({ mcp, server }) => {
    const baseUrl = server.info.baseUrl;
    const refused = await mcp.tools.call('deploy-service', { service: 'billing' });
    expect(refused).toBeError();
    expect(refused).toHaveTextContent('requires approval to execute');

    const inbox = (await (await fetch(`${baseUrl}/test/approval-inbox`)).json()) as ReceivedApprovalRequest[];
    expect(inbox).toHaveLength(1);
    const [request] = inbox;
    expect(request.headers['webhook-signature']).toBe(
      sign(request.headers['webhook-id'], request.headers['webhook-timestamp'], request.body),
    );
    const payload = JSON.parse(request.body) as { toolId: string; codeVerifier: string; callbackPath: string };
    expect(payload).toMatchObject({ toolId: 'ops:deploy-service', callbackPath: '/approval/callback' });

    const forged = JSON.stringify({ codeVerifier: payload.codeVerifier, approved: true });
    const unsigned = await fetch(`${baseUrl}/approval/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: forged,
    });
    expect(unsigned.status).toBe(401);
    expect(await mcp.tools.call('deploy-service', { service: 'billing' })).toBeError();

    const decision = JSON.stringify({ codeVerifier: payload.codeVerifier, approved: true });
    const accepted = await fetch(`${baseUrl}/approval/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedHeaders(decision) },
      body: decision,
    });
    expect(accepted.status).toBe(202);

    const deployment = await mcp.tools.call('deploy-service', { service: 'billing' });
    expect(deployment).toBeSuccessful();
    expect(deployment.json()).toEqual({ deployed: 'billing' });
  });
});
