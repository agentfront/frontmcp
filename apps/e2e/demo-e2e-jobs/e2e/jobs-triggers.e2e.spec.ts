/**
 * E2E: workflow triggers on a real server. A `trigger: 'webhook'` workflow's route starts a run for a request signed
 * with its secret, with its JSON body as input; an unsigned, badly signed or replayed one gets 401; a workflow whose
 * execute rules don't allow `webhook:<workflow>` answers 403. A `trigger: 'event'` workflow starts when a tool emits
 * its event on the scope's event bus, with the payload as input. A `trigger: 'schedule'` workflow starts at each time
 * of its cron, with its schedule's input.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { bytesToHex, hmacSha256, randomBytes } from '@frontmcp/utils';

const encoder = new TextEncoder();
const DEPLOY_SECRET = bytesToHex(randomBytes(32));
const RELEASE_SECRET = bytesToHex(randomBytes(32));
// The schedule's lease lives in a folder of this run's own, so no other server on the machine holds it
const LEASE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-triggers-'));

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
    env: { DEPLOY_WEBHOOK_SECRET: DEPLOY_SECRET, RELEASE_WEBHOOK_SECRET: RELEASE_SECRET, FRONTMCP_HOME: LEASE_HOME },
  });

  test.afterAll(() => {
    fs.rmSync(LEASE_HOME, { recursive: true, force: true });
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

  test('a schedule starts a run at each of its times, with its input, as schedule:<workflow>', async ({ mcp }) => {
    const scheduled = async () => {
      const result = await mcp.tools.call('get-deliveries', {});
      const { deliveries } = result.json<{ deliveries: Array<Record<string, unknown>> }>();
      return deliveries.filter((delivery) => delivery['ref'] === 'scheduled');
    };

    expect(await deliveriesOnceThere(mcp, (delivery) => delivery['ref'] === 'scheduled')).toEqual({
      ref: 'scheduled',
    });
    const seenAt = Date.now();
    const seen = (await scheduled()).length;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const later = (await scheduled()).length;

    expect(later).toBeGreaterThan(seen);
    expect(later - seen).toBeLessThanOrEqual(Math.ceil((Date.now() - seenAt) / 1_000) + 1);
  });

  test('an event a tool emits starts the workflow that listens to it', async ({ mcp }) => {
    const result = await mcp.tools.call('sign-up', { email: 'grace@example.com' });
    expect(result.json()).toEqual({ emitted: true });

    expect(await deliveriesOnceThere(mcp, (delivery) => delivery['email'] === 'grace@example.com')).toEqual({
      email: 'grace@example.com',
    });
  });
});
