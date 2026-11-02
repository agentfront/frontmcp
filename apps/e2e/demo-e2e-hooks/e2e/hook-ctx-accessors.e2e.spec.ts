/**
 * E2E: a hook reads the tool name and the request from its ctx, and sends list_changed through it.
 *
 * The request-probe plugin's `Will('execute')` hook, filtered on `ctx.toolName`, reports `ctx.toolName` and
 * `ctx.request` for a `probe-request` call in the result `_meta`, then calls `ctx.notify.listChanged('tools')`.
 */
import { expect, test } from '@frontmcp/testing';

interface RequestProbe {
  toolName: string;
  sessionId?: string;
  clientInfo?: { name: string; version: string };
}

test.describe('Hook ctx accessors E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-hooks/src/main.ts',
    project: 'demo-e2e-hooks',
    publicMode: true,
  });

  test('a hook reads the tool name, the session and the client info from its ctx', async ({ server }) => {
    const client = await server.createClient({ clientInfo: { name: 'hooks-e2e-client', version: '2.1.0' } });

    const result = await client.tools.call('probe-request', {});

    expect(result).toBeSuccessful();
    expect(result.raw._meta?.['request-probe']).toMatchObject<RequestProbe>({
      toolName: 'probe-request',
      sessionId: client.sessionId,
      clientInfo: { name: 'hooks-e2e-client', version: '2.1.0' },
    });
  });

  test('ctx.notify.listChanged() reaches the client as notifications/tools/list_changed', async ({ server }) => {
    const client = await server.createClient();
    const notifications = client.notifications.collect();

    await client.tools.call('probe-request', {});

    const notification = await notifications.waitFor('notifications/tools/list_changed', 5000);
    expect(notification.method).toBe('notifications/tools/list_changed');
  });

  test('the hook filter reads ctx.toolName: other tools get no probe', async ({ mcp }) => {
    const result = await mcp.tools.call('plain-echo', { message: 'hello', user: 'someone' });

    expect(result).toBeSuccessful();
    expect(result.raw._meta?.['request-probe']).toBeUndefined();
  });
});
