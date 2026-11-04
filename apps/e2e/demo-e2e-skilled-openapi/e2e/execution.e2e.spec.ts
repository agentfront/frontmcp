// Scenarios A2 E1 E2 E3 F1 G1 G3: run_workflow against the mock billing API over HTTPS, with the production settings.
import { expect, test } from '@frontmcp/testing';

import { SLOW_REPORT_DELAY_MS } from './helpers/mock-billing-api';
import { ProductionEnvironment } from './helpers/production-environment';
import {
  asAdmin,
  asViewer,
  callToolOver,
  runWorkflow,
  sharedOperationAccess,
  SKILLED_SERVER,
  type ActionOutcome,
} from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({ ...SKILLED_SERVER, env: environment.env });
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());
test.beforeEach(() => environment.billingApi.reset());

function requestsTo(path: string): number {
  return environment.billingApi.requests.filter((request) => request.path === path).length;
}

test.describe('a chained workflow (E1)', () => {
  test('passes data between calls and returns the value the script shapes', async ({ mcp }) => {
    const result = await runWorkflow(
      mcp,
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 1234 });",
        "const fetched = await callTool('getInvoice', { id: created.id });",
        "const refund = await callTool('refundInvoice', { id: created.id, amount: 50 });",
        'return { created: created, fetched: fetched, refund: refund };',
      ].join('\n'),
    );

    expect(result).toMatchObject({ success: true, stats: { toolCalls: 3 } });
    expect(result.value).toEqual({
      created: { id: 'inv_1', status: 'open' },
      fetched: { id: 'inv_1', status: 'open', amount: 1234 },
      refund: { refundId: 'rfnd_1', invoiceId: 'inv_1' },
    });
  });
});

test.describe('operations as compileSkilledBundleFromOpenApi emits them (A2)', () => {
  test('a response the spec documents with a description only passes the JSON answer through', async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('getAccountPlan', {});");

    expect(result).toMatchObject({ success: true, value: { plan: 'growth', seats: 5 } });
  });

  test('an array query parameter with explode: true sends its key once per item', async ({ mcp }) => {
    const result = await runWorkflow(
      mcp,
      [
        "const first = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
        "const second = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 20 });",
        "return await callTool('listInvoices', { ids: [first.id, second.id] });",
      ].join('\n'),
    );

    expect(result).toMatchObject({
      success: true,
      value: {
        invoices: [
          { id: 'inv_1', amount: 10 },
          { id: 'inv_2', amount: 20 },
        ],
      },
    });
    const listRequest = environment.billingApi.requests.find(
      (request) => request.method === 'GET' && request.path === '/v1/invoices',
    );
    expect(listRequest?.query).toBe('ids=inv_1&ids=inv_2');
  });
});

test.describe('errors the agent can act on (E2)', () => {
  test('an unknown action', async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('doesNotExist', {});");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown action "doesNotExist"/);
  });

  test('an input the action schema refuses, before any request is sent', async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('getInvoice', {});");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/input validation failed.*id/i);
    expect(environment.billingApi.requests).toEqual([]);
  });

  test('a path parameter of .. or ., before any request is sent', async ({ mcp }) => {
    for (const id of ['..', '.']) {
      const result = await runWorkflow(mcp, `return await callTool('refundInvoice', { id: '${id}', amount: 1 });`);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Path parameter 'id' of operation 'refundInvoice' cannot be '.' or '..'");
    }
    expect(environment.billingApi.requests).toEqual([]);
  });

  test("a 4xx answer names the status and carries the API's error body", async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('getInvoice', { id: 'inv_missing' });");

    expect(result).toMatchObject({
      success: false,
      error: 'action "getInvoice" failed with status 404: {"error":"invoice not found"}',
    });
  });

  test("a 422 answer's JSON body reaches the model's error text", async ({ server, auth }) => {
    const result = await runWorkflow(
      await asAdmin({ server, auth }),
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 120 });",
        "return await callTool('refundInvoice', { id: created.id, amount: 500 });",
      ].join('\n'),
    );

    expect(result).toMatchObject({
      success: false,
      error:
        'action "refundInvoice" failed with status 422: {"error":"refund_too_large","message":"Refund 500 exceeds the paid amount 120.","maxRefund":120}',
    });
  });

  test('a script with throwOnError false branches on a 404 and returns a fallback', async ({ mcp }) => {
    const result = await runWorkflow(
      mcp,
      [
        "const found = await callTool('getInvoice', { id: 'inv_missing' }, { throwOnError: false });",
        'if (!found.ok && found.status === 404) return { invoice: null, reason: found.data.error, outcome: found };',
        'return { invoice: found.data };',
      ].join('\n'),
    );

    const outcome: ActionOutcome = { ok: false, status: 404, data: { error: 'invoice not found' } };
    expect(result).toMatchObject({ success: true, value: { invoice: null, reason: 'invoice not found', outcome } });
  });

  test('a failed workflow is an error result, with the same structured content', async ({ mcp }) => {
    const result = await mcp.tools.call('run_workflow', {
      script: "return await callTool('getInvoice', { id: 'inv_missing' });",
    });

    expect(result.isError).toBe(true);
    expect(result.raw.isError).toBe(true);
    expect(result.raw.structuredContent).toMatchObject({
      success: false,
      error: 'action "getInvoice" failed with status 404: {"error":"invoice not found"}',
      stats: { toolCalls: 1 },
    });
  });

  test('a workflow that succeeds is not an error result', async ({ mcp }) => {
    const result = await mcp.tools.call('run_workflow', { script: "return await callTool('getAccountPlan', {});" });

    expect(result.isError).toBe(false);
    expect(result.raw.isError).toBeFalsy();
  });

  test("an answer that doesn't match the action's output schema", async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('getAccountBalance', {});");

    expect(result).toMatchObject({
      success: false,
      error: 'upstream response failed output schema: balance: Invalid input: expected number, received string',
    });
  });

  test('a 204 answer succeeds with no data', async ({ server, auth }) => {
    const result = await runWorkflow(
      await asAdmin({ server, auth }),
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
        "const voided = await callTool('voidInvoice', { id: created.id });",
        "const after = await callTool('getInvoice', { id: created.id });",
        'return { voided: voided, status: after.status };',
      ].join('\n'),
    );

    expect(result).toMatchObject({ success: true, value: { status: 'void' } });
    expect(result.value).not.toHaveProperty('voided');
  });
});

test.describe('limits (E3)', () => {
  test('a workflow makes at most 25 calls', async ({ mcp }) => {
    const result = await runWorkflow(
      mcp,
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
        'for (let call = 0; call < 30; call += 1) {',
        "  await callTool('getInvoice', { id: created.id });",
        '}',
        "return 'unreachable';",
      ].join('\n'),
    );

    expect(result).toMatchObject({ success: false, error: 'Tool call limit exceeded (25)' });
    expect(environment.billingApi.requests).toHaveLength(25);
  });

  test("an answer larger than the operation's maxResponseBytes is refused", async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('listInvoiceEvents', { id: 'inv_1' });");

    expect(result).toMatchObject({ success: false, error: 'response exceeded maxResponseBytes (1024)' });
  });

  test("a request that outlasts the operation's timeoutMs is abandoned", async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('getRevenueReport', {});");

    expect(result).toMatchObject({ success: false, error: 'timeout after 250ms' });
    expect(result.stats?.durationMs).toBeLessThan(SLOW_REPORT_DELAY_MS);
  });

  test('a workflow that runs out of time aborts the request it is waiting on', async ({ mcp }) => {
    const result = await runWorkflow(mcp, "return await callTool('exportRevenueReport', { month: '2026-10' });");

    expect(result).toMatchObject({ success: false, error: 'Execution timed out after 8000ms' });
    expect(environment.billingApi.heldExports).toHaveLength(1);
    const [held] = environment.billingApi.heldExports;
    const closedAt = await held.closedAt;
    expect(held.answered).toBe(false);
    expect(closedAt - held.receivedAt).toBeLessThan(9_000);
  });
});

test.describe('the upstream credential (F1)', () => {
  test('reaches the billing API by value, on every request', async ({ mcp }) => {
    const result = await runWorkflow(
      mcp,
      "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 }); return await callTool('getInvoice', { id: created.id });",
    );

    expect(result.success).toBe(true);
    expect(environment.billingApi.requests.map((request) => request.authorization)).toEqual([
      `Bearer ${environment.billingToken}`,
      `Bearer ${environment.billingToken}`,
    ]);
  });

  test('never appears in a result, an error or the server log', async ({ mcp, server }) => {
    const scripts = [
      "return await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
      "return await callTool('getInvoice', { id: 'inv_missing' });",
      "return await callTool('getAccountBalance', {});",
      "return await callTool('getRevenueReport', {});",
      "return await callTool('adminPing', {});",
    ];
    const outputs: unknown[] = [];
    for (const script of scripts) outputs.push(await runWorkflow(mcp, script));
    outputs.push((await mcp.tools.call('load_skill', { skillId: 'invoices' })).raw);

    expect(environment.billingApi.requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(outputs)).not.toContain(environment.billingToken);
    expect(server.getLogs().filter((line) => line.includes(environment.billingToken))).toEqual([]);
  });
});

test.describe('caller authorization (G1)', () => {
  test('an action of a skill gated by a role runs only for a caller with the role', async ({ mcp, server, auth }) => {
    const script = "return await callTool('adminPing', {});";

    const asAnonymous = await runWorkflow(mcp, script);
    const asViewerResult = await runWorkflow(await asViewer({ server, auth }), script);
    const asAdminResult = await runWorkflow(await asAdmin({ server, auth }), script);

    expect(asAnonymous).toMatchObject({
      success: false,
      error: "authority denied: roles.any: user has none of 'admin'",
    });
    expect(asViewerResult).toMatchObject({
      success: false,
      error: "authority denied: roles.any: user has none of 'admin'",
    });
    expect(asAdminResult).toMatchObject({ success: true, value: { ok: true } });
    expect(requestsTo('/v1/admin/ping')).toBe(1);
  });

  test('unprotectedOps "deny" blocks an operation with no rule that is not public, for every caller', async ({
    mcp,
    server,
    auth,
  }) => {
    const script = "return await callTool('getUsageStats', {});";

    for (const client of [mcp, await asAdmin({ server, auth })]) {
      expect(await runWorkflow(client, script)).toMatchObject({
        success: false,
        error: 'authority denied: unprotected_operation_denied',
      });
    }
    expect(environment.billingApi.requests).toEqual([]);
  });

  test("a rule on the action's input is checked when the action runs", async ({ mcp, server, auth }) => {
    const refund = (amount: number) =>
      [
        "const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 1000 });",
        `return await callTool('refundInvoice', { id: created.id, amount: ${amount} });`,
      ].join('\n');

    expect(await runWorkflow(mcp, refund(50))).toMatchObject({ success: true });
    expect(await runWorkflow(await asViewer({ server, auth }), refund(500))).toMatchObject({
      success: false,
      error: "authority denied: attributes.conditions: 'input.amount' failed 'lte' check against '100'",
    });
    expect(await runWorkflow(await asAdmin({ server, auth }), refund(500))).toMatchObject({ success: true });
    expect(requestsTo('/v1/invoices/inv_2/refunds')).toBe(0);
  });
});

test.describe('an operation a public and an admin-only skill both list (G3)', () => {
  test('runs for a viewer, who sees it through the public skill, though the admin-only skill lists it first', async ({
    server,
    auth,
  }) => {
    const access = await sharedOperationAccess(callToolOver(await asViewer({ server, auth })));

    expect(access).toEqual({ shown: ['getInvoice'], runnable: ['getInvoice'] });
  });

  test('runs for an admin, with the actions only the admin-only skill lists', async ({ server, auth }) => {
    const access = await sharedOperationAccess(callToolOver(await asAdmin({ server, auth })));

    expect(access).toEqual({ shown: ['getInvoice', 'voidInvoice'], runnable: ['getInvoice', 'voidInvoice'] });
  });
});
