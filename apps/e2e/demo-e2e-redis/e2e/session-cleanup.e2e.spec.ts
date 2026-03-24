/**
 * E2E Tests for Session Cleanup After DELETE
 *
 * Tests that session data and transport state are properly cleaned up
 * when a session is terminated via DELETE. Verifies:
 * - Session data is not accessible after termination
 * - New sessions don't inherit old session state
 * - Multiple DELETE/reconnect cycles don't accumulate stale data
 */
import { test, expect } from '@frontmcp/testing';

/**
 * Send a DELETE request to terminate a session.
 */
async function sendDelete(baseUrl: string, sessionId: string): Promise<{ status: number }> {
  const response = await fetch(`${baseUrl}/`, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId },
  });
  return { status: response.status };
}

test.describe('Session Cleanup E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    project: 'demo-e2e-redis',
    publicMode: true,
  });

  test.describe('Session data isolation after DELETE', () => {
    test('session data should not be accessible after DELETE and reconnect', async ({ mcp, server }) => {
      // Store data in original session
      const setResult = await mcp.tools.call('set-session-data', { key: 'cleanup-test', value: 'original-data' });
      expect(setResult).toBeSuccessful();

      // Verify data exists
      const getResult = await mcp.tools.call('get-session-data', { key: 'cleanup-test' });
      expect(getResult).toBeSuccessful();
      expect(getResult).toHaveTextContent('original-data');

      const oldSessionId = mcp.sessionId;
      expect(oldSessionId).toBeTruthy();

      // DELETE the session
      const { status } = await sendDelete(server.info.baseUrl, oldSessionId);
      expect(status).toBe(204);

      // Create a new client (fresh session)
      const newClient = await server.createClient();

      // New session should have a different ID
      const infoResult = await newClient.tools.call('session-info', {});
      expect(infoResult).toBeSuccessful();
      expect(newClient.sessionId).not.toBe(oldSessionId);

      // Old session data should NOT be accessible in new session
      const getOldData = await newClient.tools.call('get-session-data', { key: 'cleanup-test' });
      expect(getOldData).toBeSuccessful();
      // Data should be empty/not found (not 'original-data')
      expect(getOldData).not.toHaveTextContent('original-data');

      await newClient.disconnect();
    });

    test('session info should reflect new session after reconnect', async ({ mcp, server }) => {
      // Get original session info
      const info1 = await mcp.tools.call('session-info', {});
      expect(info1).toBeSuccessful();
      const oldSessionId = mcp.sessionId;

      // DELETE
      await sendDelete(server.info.baseUrl, oldSessionId);

      // Reconnect with new client
      const newClient = await server.createClient();
      const info2 = await newClient.tools.call('session-info', {});
      expect(info2).toBeSuccessful();

      // Session ID should differ
      expect(newClient.sessionId).toBeTruthy();
      expect(newClient.sessionId).not.toBe(oldSessionId);

      await newClient.disconnect();
    });
  });

  test.describe('Multiple DELETE/reconnect cycles', () => {
    test('should not accumulate stale data across 5 cycles', async ({ server }) => {
      for (let cycle = 0; cycle < 5; cycle++) {
        const client = await server.createClient();

        // Store cycle-specific data
        const setResult = await client.tools.call('set-session-data', {
          key: `cycle-data`,
          value: `cycle-${cycle}`,
        });
        expect(setResult).toBeSuccessful();

        // Verify current cycle data
        const getResult = await client.tools.call('get-session-data', { key: 'cycle-data' });
        expect(getResult).toBeSuccessful();
        expect(getResult).toHaveTextContent(`cycle-${cycle}`);

        // DELETE session
        const sessionId = client.sessionId;
        await sendDelete(server.info.baseUrl, sessionId);

        await client.disconnect();
      }

      // Final client should have clean state
      const finalClient = await server.createClient();
      const finalGet = await finalClient.tools.call('get-session-data', { key: 'cycle-data' });
      expect(finalGet).toBeSuccessful();
      // Should NOT contain data from any previous cycle
      expect(finalGet).not.toHaveTextContent('cycle-0');
      expect(finalGet).not.toHaveTextContent('cycle-4');

      await finalClient.disconnect();
    });
  });

  test.describe('Cross-client isolation on DELETE', () => {
    test('deleting one client should not affect another', async ({ server }) => {
      // Client A: store data
      const clientA = await server.createClient();
      await clientA.tools.call('set-session-data', { key: 'client-key', value: 'client-a-data' });
      const sessionA = clientA.sessionId;

      // Client B: store data
      const clientB = await server.createClient();
      await clientB.tools.call('set-session-data', { key: 'client-key', value: 'client-b-data' });

      // DELETE Client A
      await sendDelete(server.info.baseUrl, sessionA);

      // Client B should still have its data
      const bResult = await clientB.tools.call('get-session-data', { key: 'client-key' });
      expect(bResult).toBeSuccessful();
      expect(bResult).toHaveTextContent('client-b-data');

      // Client B session info should still work
      const bInfo = await clientB.tools.call('session-info', {});
      expect(bInfo).toBeSuccessful();

      await clientA.disconnect();
      await clientB.disconnect();
    });
  });
});
