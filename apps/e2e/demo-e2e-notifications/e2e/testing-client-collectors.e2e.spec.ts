/**
 * The @frontmcp/testing collectors record what a real server sends on the
 * session's notification stream, and toBeError matches the tool error code.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('McpTestClient notification collectors', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
  });

  test('collectProgress() records the progress a tool reports', async ({ mcp }) => {
    const progress = mcp.notifications.collectProgress();

    const result = await mcp.tools.call('test-progress-method', { steps: 3, includeTotal: true });

    expect(result).toBeSuccessful();
    expect(result.json()).toMatchObject({ progressSent: 3 });
    await progress.waitForComplete(5000);
    expect(progress.all.map(({ progress: value, total }) => ({ value, total }))).toEqual([
      { value: 1, total: 3 },
      { value: 2, total: 3 },
      { value: 3, total: 3 },
    ]);
  });

  test('collect() records the log message a tool sends', async ({ mcp }) => {
    const notifications = mcp.notifications.collect();
    await mcp.raw.request({ jsonrpc: '2.0', id: 'set-level', method: 'logging/setLevel', params: { level: 'info' } });

    const result = await mcp.tools.call('test-notify-method', { message: 'Importing 2 files', level: 'info' });

    expect(result).toBeSuccessful();
    const logMessage = await notifications.waitFor('notifications/message', 5000);
    expect(logMessage.params).toMatchObject({ level: 'info', data: { message: 'Importing 2 files' } });
  });

  test('toBeError matches the tool error code of an invalid call', async ({ mcp }) => {
    const result = await mcp.tools.call('test-progress-method', { steps: 0 });

    expect(result).toBeError('INVALID_INPUT');
  });

  test('toBeError matches the tool error code of an unknown tool', async ({ mcp }) => {
    expect(await mcp.tools.call('unknown-tool', {})).toBeError('TOOL_NOT_FOUND');
  });

  test('toBeError matches the JSON-RPC error code of an unknown prompt', async ({ mcp }) => {
    expect(await mcp.prompts.get('unknown-prompt')).toBeError(-32602);
  });
});
