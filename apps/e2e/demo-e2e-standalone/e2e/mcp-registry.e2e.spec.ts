/**
 * E2E: `@FrontMcp({ registry })` on a spawned Node server with a standalone app, the key in
 * MCP_REGISTRY_PUBLIC_KEY and the MCP endpoint at `/mcp`.
 */
import * as path from 'node:path';

import { TestServer } from '@frontmcp/testing';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');
const PUBLIC_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

describe('MCP Registry documents', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-standalone/src/main-registry.ts',
      project: 'demo-e2e-standalone',
      cwd: WORKSPACE_ROOT,
      env: { MCP_REGISTRY_PUBLIC_KEY: PUBLIC_KEY },
    });
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
  });

  it('serves the domain proof from the environment at the root of the host', async () => {
    const proof = await fetch(`${server.info.baseUrl}/.well-known/mcp-registry-auth`, { redirect: 'manual' });
    expect(proof.status).toBe(200);
    expect(await proof.text()).toBe(`v=MCPv1; k=ed25519; p=${PUBLIC_KEY}`);
    expect((await fetch(`${server.info.baseUrl}/mcp/.well-known/mcp-registry-auth`)).status).toBe(404);
  });

  it('serves the server card of the server endpoint only', async () => {
    const card = await fetch(`${server.info.baseUrl}/mcp/server-card`);
    expect(card.status).toBe(200);
    expect(card.headers.get('access-control-allow-origin')).toBe('*');
    const body = await card.json();
    expect(body).toMatchObject({
      name: 'com.example/registry-e2e',
      version: '0.1.0',
      description: 'MCP Registry e2e fixture',
      websiteUrl: 'https://example.com/registry',
      remotes: [{ type: 'streamable-http', url: `${server.info.baseUrl}/mcp` }],
    });
    expect((await fetch(`${server.info.baseUrl}/mcp/isolated/server-card`)).status).toBe(404);
  });

  it('lists the card in the AI Catalog', async () => {
    const catalog = await (await fetch(`${server.info.baseUrl}/.well-known/ai-catalog.json`)).json();
    expect(catalog).toEqual({
      specVersion: '1.0',
      entries: [
        {
          identifier: 'urn:air:example.com:mcp:registry-e2e',
          type: 'application/mcp-server-card+json',
          url: `${server.info.baseUrl}/mcp/server-card`,
        },
      ],
    });
  });
});
