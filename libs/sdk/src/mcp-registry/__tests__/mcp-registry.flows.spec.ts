/**
 * MCP Registry support: the domain proof, the SEP-2127 server card and the AI Catalog, driven over
 * the fetch handler (`createFetchHandler`, what a Cloudflare Worker runs) and the Express host
 * (`createHandler`, what Node, Vercel and Lambda run).
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS } from '../../transport/mcp-20260728/protocol-20260728.constants';

const ED25519_PUBLIC_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const OTHER_ED25519_PUBLIC_KEY = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=';
const ECDSA_P384_RECORD = 'v=MCPv1;k=ecdsap384;p=AgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ==';
const PUBLIC_HOST = 'mcp.acme.com';

@Tool({ name: 'forecast', inputSchema: {} })
class ForecastTool extends ToolContext {
  async execute() {
    return 'sunny';
  }
}

@App({ id: 'weather', name: 'Weather', tools: [ForecastTool] })
class WeatherApp {}

@App({ id: 'alerts', name: 'Alerts', tools: [ForecastTool] })
class AlertsApp {}

@App({ id: 'isolated', name: 'Isolated', standalone: true, tools: [ForecastTool] })
class IsolatedApp {}

interface TestHost {
  /** The origin the server card names: the request's own. */
  origin: string;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
}

const realFetch = globalThis.fetch;
const nodeServers: http.Server[] = [];

async function createFetchHost(config: FrontMcpConfigInput): Promise<TestHost> {
  const handler = await FrontMcpInstance.createFetchHandler(config);
  return {
    origin: `https://${PUBLIC_HOST}`,
    get: (path, headers) => handler(new Request(`https://${PUBLIC_HOST}${path}`, { headers })),
  };
}

async function createExpressHost(config: FrontMcpConfigInput): Promise<TestHost> {
  const app = (await FrontMcpInstance.createHandler(config)) as http.RequestListener;
  const server = http.createServer(app);
  nodeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, get: (path, headers) => realFetch(`${origin}${path}`, { headers, redirect: 'manual' }) };
}

afterAll(async () => {
  await Promise.all(nodeServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function withEnv(name: string, value: string | undefined): () => void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

function serverConfig(overrides: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: {
      name: 'weather',
      title: 'Weather',
      version: '1.2.0',
      websiteUrl: 'https://acme.com/weather',
      icons: [
        { src: 'https://acme.com/icon.png', mimeType: 'image/png' },
        { src: 'http://acme.com/insecure.png', mimeType: 'image/png' },
      ],
    },
    logging: { level: LogLevel.Off },
    apps: [WeatherApp],
    http: { entryPath: '/mcp' },
    ...overrides,
  } as FrontMcpConfigInput;
}

describe.each([
  ['the fetch handler', createFetchHost],
  ['the Express host', createExpressHost],
])('MCP Registry documents on %s', (_hostName, createHost) => {
  let restoreEnv: Array<() => void> = [];

  beforeEach(() => {
    restoreEnv = [withEnv('MCP_REGISTRY_PUBLIC_KEY', undefined), withEnv('FRONTMCP_PUBLIC_URL', undefined)];
  });

  afterEach(() => {
    for (const restore of restoreEnv.reverse()) restore();
  });

  describe('with a complete registry option', () => {
    let host: TestHost;

    beforeAll(async () => {
      host = await createHost(
        serverConfig({
          http: { entryPath: '/mcp', cors: { origin: 'https://app.example.com' } },
          registry: {
            name: 'com.acme/weather',
            description: 'Forecasts and alerts for any city',
            repository: { url: 'https://github.com/acme/weather-mcp', source: 'github' },
            publicKey: ED25519_PUBLIC_KEY,
          },
        }),
      );
    });

    it('serves the decorator key as the domain proof at the root, whatever the entry path', async () => {
      const response = await host.get('/.well-known/mcp-registry-auth');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
      expect(await response.text()).toBe(`v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`);

      expect((await host.get('/mcp/.well-known/mcp-registry-auth')).status).toBe(404);
      expect((await host.get('/.well-known/mcp-registry-auth/mcp')).status).toBe(404);
    });

    it('serves the server card next to the MCP endpoint', async () => {
      const response = await host.get('/mcp/server-card');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/mcp-server-card\+json/);
      expect(await response.json()).toEqual({
        $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
        name: 'com.acme/weather',
        version: '1.2.0',
        description: 'Forecasts and alerts for any city',
        title: 'Weather',
        websiteUrl: 'https://acme.com/weather',
        icons: [{ src: 'https://acme.com/icon.png', mimeType: 'image/png' }],
        repository: { url: 'https://github.com/acme/weather-mcp', source: 'github' },
        remotes: [
          {
            type: 'streamable-http',
            url: `${host.origin}/mcp`,
            supportedProtocolVersions: [...FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS],
          },
        ],
      });
      expect((await host.get('/server-card')).status).toBe(404);
    });

    it('sends the card with public CORS, caching and an ETag, whatever http.cors allows', async () => {
      const response = await host.get('/mcp/server-card', { origin: 'https://inspector.example.com' });
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toBe('GET');
      expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, If-None-Match');
      expect(response.headers.get('access-control-expose-headers')).toBe('ETag');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(response.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]+"$/);
    });

    it('answers 304 to an If-None-Match naming the card', async () => {
      const etag = (await host.get('/mcp/server-card')).headers.get('etag') ?? '';
      for (const ifNoneMatch of [etag, `W/${etag}`, `"stale", ${etag}`, '*']) {
        const response = await host.get('/mcp/server-card', { 'if-none-match': ifNoneMatch });
        expect(response.status).toBe(304);
        expect(response.headers.get('etag')).toBe(etag);
        expect(await response.text()).toBe('');
      }
      expect((await host.get('/mcp/server-card', { 'if-none-match': '"stale"' })).status).toBe(200);
    });

    it('serves the AI Catalog at the root', async () => {
      const response = await host.get('/.well-known/ai-catalog.json');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/ai-catalog\+json/);
      expect(await response.json()).toEqual({
        specVersion: '1.0',
        entries: [
          {
            identifier: 'urn:air:acme.com:mcp:weather',
            type: 'application/mcp-server-card+json',
            url: `${host.origin}/mcp/server-card`,
          },
        ],
      });
    });

    it('names FRONTMCP_PUBLIC_URL in the card and the catalog when it is set', async () => {
      restoreEnv.push(withEnv('FRONTMCP_PUBLIC_URL', 'https://public.acme.com/'));
      const card = await (await host.get('/mcp/server-card')).json();
      expect(card.remotes[0].url).toBe('https://public.acme.com/mcp');
      const catalog = await (await host.get('/.well-known/ai-catalog.json')).json();
      expect(catalog.entries[0].url).toBe('https://public.acme.com/mcp/server-card');
    });
  });

  describe('with a whole record and the endpoint at the root', () => {
    let host: TestHost;

    beforeAll(async () => {
      host = await createHost(
        serverConfig({
          http: { entryPath: '' },
          registry: { name: 'io.github.acme/weather', description: 'Forecasts', publicKey: ECDSA_P384_RECORD },
        }),
      );
    });

    it('serves the record as given', async () => {
      expect(await (await host.get('/.well-known/mcp-registry-auth')).text()).toBe(ECDSA_P384_RECORD);
    });

    it('serves the card at /server-card, naming the root endpoint', async () => {
      const card = await (await host.get('/server-card')).json();
      expect(card.remotes[0].url).toBe(`${host.origin}/`);
      const catalog = await (await host.get('/.well-known/ai-catalog.json')).json();
      expect(catalog.entries[0]).toMatchObject({
        identifier: 'urn:air:acme.github.io:mcp:weather',
        url: `${host.origin}/server-card`,
      });
    });
  });

  describe('with the key in the environment', () => {
    let host: TestHost;

    beforeAll(async () => {
      host = await createHost(serverConfig({ registry: { name: 'com.acme/weather', description: 'Forecasts' } }));
    });

    it('reads MCP_REGISTRY_PUBLIC_KEY on each request', async () => {
      expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(404);

      restoreEnv.push(withEnv('MCP_REGISTRY_PUBLIC_KEY', ED25519_PUBLIC_KEY));
      expect(await (await host.get('/.well-known/mcp-registry-auth')).text()).toBe(
        `v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`,
      );

      process.env['MCP_REGISTRY_PUBLIC_KEY'] = OTHER_ED25519_PUBLIC_KEY;
      expect(await (await host.get('/.well-known/mcp-registry-auth')).text()).toBe(
        `v=MCPv1; k=ed25519; p=${OTHER_ED25519_PUBLIC_KEY}`,
      );
    });

    it('answers 404 when the environment holds no valid key', async () => {
      restoreEnv.push(withEnv('MCP_REGISTRY_PUBLIC_KEY', '9f'.repeat(32)));
      expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(404);
    });
  });

  describe('with a custom key variable and no name', () => {
    let host: TestHost;

    beforeAll(async () => {
      host = await createHost(serverConfig({ registry: { publicKeyEnv: 'ACME_REGISTRY_KEY' } }));
    });

    it('reads the variable publicKeyEnv names', async () => {
      restoreEnv.push(withEnv('ACME_REGISTRY_KEY', ED25519_PUBLIC_KEY));
      restoreEnv.push(withEnv('MCP_REGISTRY_PUBLIC_KEY', OTHER_ED25519_PUBLIC_KEY));
      expect(await (await host.get('/.well-known/mcp-registry-auth')).text()).toBe(
        `v=MCPv1; k=ed25519; p=${ED25519_PUBLIC_KEY}`,
      );
    });

    it('serves neither the card nor the catalog', async () => {
      expect((await host.get('/mcp/server-card')).status).toBe(404);
      expect((await host.get('/.well-known/ai-catalog.json')).status).toBe(404);
    });
  });

  it('serves nothing without the registry option, even with the key in the environment', async () => {
    const host = await createHost(serverConfig());
    restoreEnv.push(withEnv('MCP_REGISTRY_PUBLIC_KEY', ED25519_PUBLIC_KEY));
    expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(404);
    expect((await host.get('/mcp/server-card')).status).toBe(404);
    expect((await host.get('/.well-known/ai-catalog.json')).status).toBe(404);
  });

  it('serves no card and no catalog with serverCard: false', async () => {
    const host = await createHost(
      serverConfig({
        registry: {
          name: 'com.acme/weather',
          description: 'Forecasts',
          publicKey: ED25519_PUBLIC_KEY,
          serverCard: false,
        },
      }),
    );
    expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(200);
    expect((await host.get('/mcp/server-card')).status).toBe(404);
    expect((await host.get('/.well-known/ai-catalog.json')).status).toBe(404);
  });

  it('serves the card without the catalog with aiCatalog: false', async () => {
    const host = await createHost(
      serverConfig({ registry: { name: 'com.acme/weather', description: 'Forecasts', aiCatalog: false } }),
    );
    expect((await host.get('/mcp/server-card')).status).toBe(200);
    expect((await host.get('/.well-known/ai-catalog.json')).status).toBe(404);
  });

  it("describes the server's endpoint, not a standalone app's", async () => {
    const host = await createHost(
      serverConfig({
        apps: [IsolatedApp, WeatherApp],
        registry: { name: 'com.acme/weather', description: 'Forecasts', publicKey: ED25519_PUBLIC_KEY },
      }),
    );
    expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(200);
    expect((await (await host.get('/mcp/server-card')).json()).remotes[0].url).toBe(`${host.origin}/mcp`);
    expect((await host.get('/mcp/isolated/server-card')).status).toBe(404);
    expect((await (await host.get('/.well-known/ai-catalog.json')).json()).entries).toHaveLength(1);
  });

  it('serves only the domain proof with splitByApp', async () => {
    const host = await createHost(
      serverConfig({
        apps: [WeatherApp, AlertsApp],
        splitByApp: true,
        registry: { name: 'com.acme/weather', description: 'Forecasts', publicKey: ED25519_PUBLIC_KEY },
      }),
    );
    expect((await host.get('/.well-known/mcp-registry-auth')).status).toBe(200);
    for (const path of ['/mcp/server-card', '/mcp/weather/server-card', '/.well-known/ai-catalog.json']) {
      expect((await host.get(path)).status).toBe(404);
    }
  });
});
