/**
 * E2E: a `trigger: 'webhook'` workflow, served over HTTP by a real server. A request signed with the workflow's secret
 * starts a run with its JSON body as input; an unsigned, badly signed or replayed one gets 401; a workflow whose
 * execute rules don't allow `webhook:<workflow>` answers 403.
 */
import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { bytesToHex, hmacSha256, randomBytes } from '@frontmcp/utils';

const encoder = new TextEncoder();
const DEPLOY_SECRET = bytesToHex(randomBytes(32));
const RELEASE_SECRET = bytesToHex(randomBytes(32));

/** The headers of a request signed as FrontMCP webhooks are: HMAC-SHA256 over `<timestamp>.<body>`. */
function signedHeaders(secret: string, body: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = bytesToHex(hmacSha256(encoder.encode(secret), encoder.encode(`${timestamp}.${body}`)));
  return {
    'content-type': 'application/json',
    'x-frontmcp-timestamp': timestamp,
    'x-frontmcp-signature': `v1=${signature}`,
  };
}

/** The first delivery that matches, once the job of the run that delivered it has run. */
async function deliveriesOnceThere(
  mcp: McpTestClient,
  matches: (delivery: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await mcp.tools.call('get-deliveries', {});
    const found = result.json<{ deliveries: Array<Record<string, unknown>> }>().deliveries.find(matches);
    if (found) return found;
    if (Date.now() > deadline) throw new Error('the delivery never arrived');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.describe('Workflow triggers', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-jobs/src/main.triggers.ts',
    project: 'demo-e2e-jobs',
    publicMode: true,
    env: { DEPLOY_WEBHOOK_SECRET: DEPLOY_SECRET, RELEASE_WEBHOOK_SECRET: RELEASE_SECRET },
  });

  test('a signed webhook starts a run with its body as input', async ({ mcp, server }) => {
    const body = JSON.stringify({ ref: 'refs/heads/main', pusher: 'ada' });
    const response = await fetch(`${server.info.baseUrl}/hooks/deploy`, {
      method: 'POST',
      headers: signedHeaders(DEPLOY_SECRET, body),
      body,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: expect.any(String), state: 'pending' });
    expect(await deliveriesOnceThere(mcp, (delivery) => delivery['ref'] === 'refs/heads/main')).toEqual({
      ref: 'refs/heads/main',
      pusher: 'ada',
    });
  });

  test('an unsigned, badly signed or replayed webhook gets the same 401', async ({ server }) => {
    const url = `${server.info.baseUrl}/hooks/deploy`;
    const body = JSON.stringify({ ref: 'refs/heads/replayed' });
    const signed = signedHeaders(DEPLOY_SECRET, body);
    const send = (headers: Record<string, string>) => fetch(url, { method: 'POST', headers, body });

    const unsigned = await send({ 'content-type': 'application/json' });
    const badlySigned = await send(signedHeaders(RELEASE_SECRET, body));
    expect((await send(signed)).status).toBe(202);
    const replayed = await send(signed);

    for (const refused of [unsigned, badlySigned, replayed]) {
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: 'Unauthorized' });
    }
  });

  test("a body that doesn't match the workflow's inputSchema gets 400", async ({ server }) => {
    const body = JSON.stringify({ pusher: 'ada' });
    const response = await fetch(`${server.info.baseUrl}/hooks/deploy`, {
      method: 'POST',
      headers: signedHeaders(DEPLOY_SECRET, body),
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: 'Invalid input for workflow "deploy-on-push"' }),
    );
  });

  test('a workflow whose execute rules do not allow its webhook answers 403', async ({ server }) => {
    const body = JSON.stringify({ ref: 'v2.0.0' });
    const response = await fetch(`${server.info.baseUrl}/hooks/release`, {
      method: 'POST',
      headers: signedHeaders(RELEASE_SECRET, body),
      body,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });
});
