// Scenario E7: a server whose confirm option names DELETE actions asks the user, through an MCP elicitation, before it sends one.
import { expect, test, type McpTestClient, type TestFixtures } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import { asAdmin, executeAction, runWorkflow } from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/confirm-destructive.main.ts',
  project: 'demo-e2e-skilled-openapi',
  publicMode: true,
  env: environment.env,
});
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());
test.beforeEach(() => environment.billingApi.reset());

const VOID_QUESTION =
  /^Run voidInvoice: Void an invoice; answers 204 No Content \(DELETE \/v1\/invoices\/\{id\}\) with \{"id":"inv_1"\}\?$/;

function requestsSent(): string[] {
  return environment.billingApi.requests.map((request) => `${request.method} ${request.path}`);
}

/** An admin client that answers every question as the user would, and records what it was asked. */
async function adminAnswering(
  fixtures: Pick<TestFixtures, 'auth' | 'server'>,
  action: 'accept' | 'decline',
): Promise<{ client: McpTestClient; asked: string[] }> {
  const client = await asAdmin(fixtures);
  const asked: string[] = [];
  client.onElicitation((request) => {
    asked.push(request.message);
    return action === 'accept' ? { action, content: { confirmed: true } } : { action };
  });
  return { client, asked };
}

async function createInvoice(client: McpTestClient): Promise<void> {
  await executeAction(client, 'createInvoice', { customerId: 'cus_e2e', amount: 10 });
}

test.describe('a DELETE action on a server that confirms them', () => {
  test('asks before execute_action sends it, and sends it once the user confirms', async ({ server, auth }) => {
    const { client, asked } = await adminAnswering({ server, auth }, 'accept');
    await createInvoice(client);

    const result = await executeAction(client, 'voidInvoice', { id: 'inv_1' });

    expect(result.isError).toBe(false);
    expect(asked).toEqual([expect.stringMatching(VOID_QUESTION)]);
    expect(requestsSent()).toEqual(['POST /v1/invoices', 'DELETE /v1/invoices/inv_1']);
  });

  test('sends nothing when the user declines, and the call fails saying so', async ({ server, auth }) => {
    const { client, asked } = await adminAnswering({ server, auth }, 'decline');
    await createInvoice(client);

    const result = await executeAction(client, 'voidInvoice', { id: 'inv_1' });

    expect(result.isError).toBe(true);
    expect(result.text()).toBe('the user declined: voidInvoice');
    expect(asked).toHaveLength(1);
    expect(requestsSent()).toEqual(['POST /v1/invoices']);
  });

  test('asks once for a workflow that voids several invoices, before any of its requests', async ({ server, auth }) => {
    const { client, asked } = await adminAnswering({ server, auth }, 'accept');
    const script = [
      'const ids = [];',
      'for (let count = 0; count < 3; count += 1) {',
      "  const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
      '  ids.push(created.id);',
      '}',
      "for (const id of ids) await callTool('voidInvoice', { id });",
      'return ids;',
    ].join('\n');

    const result = await runWorkflow(client, script);

    expect(result).toMatchObject({ success: true, value: ['inv_1', 'inv_2', 'inv_3'] });
    expect(asked).toEqual([expect.stringContaining('- voidInvoice: Void an invoice')]);
    expect(requestsSent().filter((request) => request.startsWith('DELETE'))).toEqual([
      'DELETE /v1/invoices/inv_1',
      'DELETE /v1/invoices/inv_2',
      'DELETE /v1/invoices/inv_3',
    ]);
  });

  test('runs none of a workflow the user declines', async ({ server, auth }) => {
    const { client } = await adminAnswering({ server, auth }, 'decline');

    const result = await runWorkflow(
      client,
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
        "return await callTool('voidInvoice', { id: created.id });",
      ].join('\n'),
    );

    expect(result).toEqual({ success: false, error: 'the user declined: voidInvoice' });
    expect(requestsSent()).toEqual([]);
  });

  test('is refused to a client without elicitation, with nothing sent', async ({ server, auth }) => {
    const token = await auth.createToken({ sub: 'alice', claims: { realm_access: { roles: ['admin'] } } });
    const client = await server.createClientBuilder().withToken(token).withCapabilities({}).buildAndConnect();
    await createInvoice(client);

    const result = await executeAction(client, 'voidInvoice', { id: 'inv_1' });

    expect(result.isError).toBe(true);
    expect(result.text()).toContain("this client can't ask for it: it doesn't support elicitation");
    expect(requestsSent()).toEqual(['POST /v1/invoices']);
  });

  test('does not ask for an action the option does not name', async ({ server, auth }) => {
    const { client, asked } = await adminAnswering({ server, auth }, 'decline');

    const created = await executeAction(client, 'createInvoice', { customerId: 'cus_e2e', amount: 10 });

    expect(created.isError).toBe(false);
    expect(asked).toEqual([]);
  });
});
