/**
 * E2E: `extApps` configuration is honoured over HTTP (issue #645).
 *  - `enabled: false` turns the ui/* methods off.
 *  - `hostCapabilities` only advertises what the host can serve.
 */
import { McpTestClient, TestServer } from '@frontmcp/testing';

const uiInitialize = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'ui/initialize',
  params: { appInfo: { name: 'widget', version: '1.0.0' }, protocolVersion: '2025-06-18' },
};

async function withServer(mode: string, run: (client: McpTestClient) => Promise<void>): Promise<void> {
  const server = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-ui/src/main.ts',
    env: { EXT_APPS_MODE: mode },
    startupTimeout: 30000,
  });
  try {
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      clientInfo: { name: 'ChatGPT', version: '1.0.0' },
    }).buildAndConnect();
    try {
      await run(client);
    } finally {
      await client.disconnect();
    }
  } finally {
    await server.stop();
  }
}

describe('extApps configuration E2E', () => {
  it('extApps.enabled: false rejects ui/* methods as unknown', async () => {
    await withServer('disabled', async (client) => {
      const response = await client.raw.request(uiInitialize);

      expect(response.error?.code).toBe(-32601);
    });
  }, 120000);

  it('advertises only the host capabilities it can serve', async () => {
    await withServer('all-capabilities', async (client) => {
      const response = await client.raw.request(uiInitialize);
      const capabilities = (response.result as { hostCapabilities: Record<string, unknown> }).hostCapabilities;

      expect(capabilities['serverToolProxy']).toBe(true);
      expect(capabilities['openLink']).toBeFalsy();
      expect(capabilities['modelContextUpdate']).toBeFalsy();
      expect(capabilities['widgetTools']).toBeFalsy();
    });
  }, 120000);
});
