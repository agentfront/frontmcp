/**
 * A live tool surface: a tool whose `enabled` is a `fileSignal()` leaves tools/list and comes back as the file
 * flips, connected sessions get `notifications/tools/list_changed`, a call to it while it is off is refused with
 * FEATURE_OFF and a remedy, and a call made from a stale list gets STALE_TOOL_LIST.
 */
import * as os from 'node:os';

import { expect, test, type McpTestClient } from '@frontmcp/testing';
import { pathJoin, rm, writeFile } from '@frontmcp/utils';

const featuresFile = pathJoin(os.tmpdir(), `frontmcp-live-surface-${process.pid}.json`);
const LIST_CHANGED = 'notifications/tools/list_changed';

/** What the features file says now. */
let reviewsOn = true;

async function setReviews(on: boolean): Promise<void> {
  reviewsOn = on;
  await writeFile(featuresFile, JSON.stringify({ reviews: on }));
}

function listChangedCount(mcp: McpTestClient): number {
  return mcp.notifications.collect().received.filter(({ method }) => method === LIST_CHANGED).length;
}

async function nextListChanged(mcp: McpTestClient, seen: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (listChangedCount(mcp) <= seen) {
    if (Date.now() > deadline) throw new Error(`no ${LIST_CHANGED} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function toolNames(mcp: McpTestClient): Promise<string[]> {
  return (await mcp.tools.list()).map(({ name }) => name);
}

/** Turn reviews on or off, and wait for the session to be told its tool list changed when that changed it. */
async function flipReviews(mcp: McpTestClient, on: boolean): Promise<void> {
  if (reviewsOn === on) return;
  const seen = listChangedCount(mcp);
  await setReviews(on);
  await nextListChanged(mcp, seen);
}

async function until(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.describe('Live tool surface E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-notifications/src/live-surface.main.ts',
    project: 'demo-e2e-notifications',
    publicMode: true,
    env: { FEATURES_FILE: featuresFile },
  });

  test.beforeAll(async () => {
    await setReviews(true);
  });

  test.afterAll(async () => {
    await rm(featuresFile, { force: true });
  });

  test('flipping the file sends tools/list_changed, and tools/list follows it', async ({ mcp }) => {
    await until(async () => (await toolNames(mcp)).includes('review_list'));

    await flipReviews(mcp, false);

    expect(await toolNames(mcp)).not.toContain('review_list');
    expect(await toolNames(mcp)).toContain('settings_set');
  });

  test('tools/list carries the hash of what it lists', async ({ mcp }) => {
    const response = await mcp.raw.request({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: {} });
    const result = (response as { result?: { _meta?: Record<string, unknown> } }).result;

    expect(result?._meta?.['frontmcp/surface']).toMatch(/^[0-9a-f]{16}$/);
  });

  test('a call to the tool while it is off is refused with FEATURE_OFF and the remedy', async ({ mcp }) => {
    await flipReviews(mcp, false);
    await toolNames(mcp);

    const result = await mcp.tools.call('review_list', {});

    expect(result).toBeError('FEATURE_OFF');
    expect(result).toHaveTextContent(
      'To fix: Turn on Reviews in Settings (call settings_set with {"feature":"reviews","on":true})',
    );
    expect(result.raw._meta?.['remedy']).toEqual({
      say: 'Turn on Reviews in Settings',
      tool: 'settings_set',
      args: { feature: 'reviews', on: true },
    });
  });

  test('the remedy turns the tool back on', async ({ mcp }) => {
    await flipReviews(mcp, false);

    const seen = listChangedCount(mcp);
    expect(await mcp.tools.call('settings_set', { feature: 'reviews', on: true })).toBeSuccessful();
    reviewsOn = true;
    await nextListChanged(mcp, seen);

    expect(await toolNames(mcp)).toContain('review_list');
    expect(await mcp.tools.call('review_list', {})).toBeSuccessful();
  });

  test('a call made from a stale tool list gets STALE_TOOL_LIST and a list_changed', async ({ mcp }) => {
    await flipReviews(mcp, true);
    expect(await toolNames(mcp)).toContain('review_list');
    await flipReviews(mcp, false);

    const seen = listChangedCount(mcp);
    const stale = await mcp.tools.call('review_list', {});

    expect(stale).toBeError('STALE_TOOL_LIST');
    expect(stale).toHaveTextContent('To fix: Call tools/list again, then call a tool from the new list.');
    await nextListChanged(mcp, seen);
    expect(await mcp.tools.call('review_list', {})).toBeError('FEATURE_OFF');
  });
});
