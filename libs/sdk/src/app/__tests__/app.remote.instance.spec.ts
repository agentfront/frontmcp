/**
 * `App.remote()` end to end through a real scope, with the network mocked at
 * the `McpClientService` boundary.
 *
 * - `transportOptions.protocolVersion` reaches the client (the metadata schema
 *   used to strip it, so every remote connected with `initialize`).
 * - Each remote entry is listed once: the remote app's registries live on the
 *   scope's providers, so the scope used to adopt them twice; and every
 *   re-discovery (cache expiry) registered another copy.
 */
import 'reflect-metadata';

import { App, type RemoteUrlAppOptions } from '../../common';
import { frontMcpRemoteAppMetadataSchema } from '../../common/metadata/app.metadata';
import type { DirectMcpServer } from '../../direct/direct.types';
import { McpClientService } from '../../remote-mcp/mcp-client.service';
import type { McpClientConnection, McpConnectRequest, McpRemoteCapabilities } from '../../remote-mcp/mcp-client.types';

const capabilities: McpRemoteCapabilities = {
  tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }],
  resources: [{ name: 'status', uri: 'test://status', mimeType: 'text/plain' }],
  resourceTemplates: [{ name: 'item', uriTemplate: 'test://items/{id}', mimeType: 'text/plain' }],
  prompts: [{ name: 'greeting', description: 'Greeting' }],
  fetchedAt: new Date(),
};

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe('App.remote()', () => {
  let server: DirectMcpServer | undefined;
  let connect: jest.SpyInstance<Promise<McpClientConnection>, [McpConnectRequest]>;
  let discover: jest.SpyInstance<Promise<McpRemoteCapabilities>, [string]>;

  beforeEach(() => {
    connect = jest
      .spyOn(McpClientService.prototype, 'connect')
      .mockImplementation(async () => ({ status: 'connected' }) as unknown as McpClientConnection);
    discover = jest.spyOn(McpClientService.prototype, 'discoverCapabilities').mockResolvedValue(capabilities);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (server) {
      await server.dispose().catch(() => undefined);
      server = undefined;
    }
  });

  async function createGateway(options: Partial<RemoteUrlAppOptions> = {}): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'remote-gateway', version: '1.0.0' },
      apps: [App.remote('http://localhost:65530/mcp', { name: 'upstream', namespace: 'up', ...options })],
    });
    return server;
  }

  describe('transportOptions.protocolVersion', () => {
    it.each(['legacy', '2026-07-28', 'auto'] as const)('keeps "%s" through the metadata schema', (protocolVersion) => {
      const parsed = frontMcpRemoteAppMetadataSchema.parse(
        App.remote('https://api.example.com/mcp', { transportOptions: { protocolVersion } }),
      );
      expect(parsed.transportOptions?.protocolVersion).toBe(protocolVersion);
    });

    it('rejects an unknown revision', () => {
      const result = frontMcpRemoteAppMetadataSchema.safeParse({
        ...App.remote('https://api.example.com/mcp'),
        transportOptions: { protocolVersion: '2099-01-01' },
      });
      expect(result.success).toBe(false);
    });

    it('passes the requested revision to the MCP client', async () => {
      await createGateway({ transportOptions: { protocolVersion: '2026-07-28', headers: { 'x-a': '1' } } });

      expect(connect).toHaveBeenCalledTimes(1);
      const [request] = connect.mock.calls[0];
      expect(request.transportType).toBe('http');
      expect(request.transportOptions).toEqual(
        expect.objectContaining({ protocolVersion: '2026-07-28', headers: { 'x-a': '1' } }),
      );
    });

    it('leaves the revision unset (legacy) when not configured', async () => {
      await createGateway();
      const [request] = connect.mock.calls[0];
      expect(request.transportOptions).toEqual(expect.objectContaining({ protocolVersion: undefined }));
    });
  });

  describe('filter (#766)', () => {
    it('proxies only the entries the filter lets through, matched by their remote names', async () => {
      const srv = await createGateway({
        filter: { exclude: { tools: ['ech*'], prompts: ['greeting'], resources: ['item'] } },
      });

      expect((await srv.listTools()).tools).toEqual([]);
      expect((await srv.listPrompts()).prompts).toEqual([]);
      expect((await srv.listResourceTemplates()).resourceTemplates).toEqual([]);
      expect((await srv.listResources()).resources.map((r) => r.uri)).toEqual(['test://status']);
    });

    it("with default: 'exclude', proxies only what include names", async () => {
      const srv = await createGateway({ filter: { default: 'exclude', include: { tools: ['echo'] } } });

      expect((await srv.listTools()).tools.map((t) => t.name)).toEqual(['up:echo']);
      expect((await srv.listResources()).resources).toEqual([]);
      expect((await srv.listPrompts()).prompts).toEqual([]);
    });
  });

  describe('listing', () => {
    it('lists each remote resource template once', async () => {
      const srv = await createGateway();
      const { resourceTemplates } = await srv.listResourceTemplates();
      expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['test://items/{id}']);
    });

    it('lists each remote resource, tool and prompt once', async () => {
      const srv = await createGateway();
      const { resources } = await srv.listResources();
      const { tools } = await srv.listTools();
      const { prompts } = await srv.listPrompts();
      expect(resources.map((r) => r.uri)).toEqual(['test://status']);
      expect(tools.map((t) => t.name)).toEqual(['up:echo']);
      expect(prompts.map((p) => p.name)).toEqual(['up:greeting']);
    });

    it('lists the entries of every remote once when the gateway has several remotes', async () => {
      const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
      server = await FrontMcpInstance.createDirect({
        info: { name: 'remote-gateway', version: '1.0.0' },
        apps: [
          App.remote('http://localhost:65530/mcp', { name: 'first', namespace: 'a' }),
          App.remote('http://localhost:65531/mcp', { name: 'second', namespace: 'b' }),
          App.remote('http://localhost:65532/mcp', { name: 'third', namespace: 'c' }),
        ],
      });

      const templates = (await server.listResourceTemplates()).resourceTemplates.map((t) => t.name).sort();
      const tools = (await server.listTools()).tools.map((t) => t.name).sort();
      const prompts = (await server.listPrompts()).prompts.map((p) => p.name).sort();
      const resources = (await server.listResources()).resources.map((r) => r.name).sort();

      expect(templates).toEqual(['a:item', 'b:item', 'c:item']);
      expect(tools).toEqual(['a:echo', 'b:echo', 'c:echo']);
      expect(prompts).toEqual(['a:greeting', 'b:greeting', 'c:greeting']);
      expect(resources).toEqual(['a:status', 'b:status', 'c:status']);
    });

    it('does not pile up copies when the capability cache expires and the remote is re-discovered', async () => {
      const srv = await createGateway({ cacheTTL: 1 });
      await srv.listResourceTemplates();
      await tick();
      const { resourceTemplates } = await srv.listResourceTemplates();
      await tick();
      const { resources } = await srv.listResources();
      await tick();
      const { tools } = await srv.listTools();
      await tick();
      const { prompts } = await srv.listPrompts();

      expect(discover.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(['test://items/{id}']);
      expect(resources.map((r) => r.uri)).toEqual(['test://status']);
      expect(tools.map((t) => t.name)).toEqual(['up:echo']);
      expect(prompts.map((p) => p.name)).toEqual(['up:greeting']);
    });

    it('drops entries the remote no longer offers after a re-discovery', async () => {
      const srv = await createGateway({ cacheTTL: 1 });
      expect((await srv.listResourceTemplates()).resourceTemplates).toHaveLength(1);

      discover.mockResolvedValue({ ...capabilities, resourceTemplates: [], tools: [] });
      await tick();

      expect((await srv.listResourceTemplates()).resourceTemplates).toEqual([]);
      await tick();
      expect((await srv.listTools()).tools).toEqual([]);
    });
  });
});
