/** Per-entry `.remote()` entries connect at startup; the network is mocked at the `McpClientService` boundary. */
import 'reflect-metadata';

import { App, LogLevel, Prompt, Resource, Tool, type PromptType, type ResourceType, type ToolType } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { ExternalEntryLoadError, ExternalEntryNotFoundError, RemoteConnectionError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { McpClientService } from '../mcp-client.service';
import type { McpClientConnection, McpConnectRequest, McpRemoteCapabilities } from '../mcp-client.types';

const URL = 'http://localhost:65533/mcp';

const capabilities: McpRemoteCapabilities = {
  tools: [
    { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } },
    { name: 'add', description: 'Add', inputSchema: { type: 'object', properties: {} } },
  ],
  resources: [{ name: 'status', uri: 'test://status', mimeType: 'text/plain' }],
  resourceTemplates: [{ name: 'item', uriTemplate: 'test://items/{id}', mimeType: 'text/plain' }],
  prompts: [{ name: 'greeting', description: 'Greeting' }],
  fetchedAt: new Date(),
};

describe('per-entry .remote() loading', () => {
  let server: DirectMcpServer | undefined;
  let connect: jest.SpyInstance<Promise<McpClientConnection>, [McpConnectRequest]>;
  let callTool: jest.SpyInstance;

  beforeEach(() => {
    connect = jest
      .spyOn(McpClientService.prototype, 'connect')
      .mockImplementation(async () => ({ status: 'connected' }) as unknown as McpClientConnection);
    jest.spyOn(McpClientService.prototype, 'discoverCapabilities').mockResolvedValue(capabilities);
    callTool = jest
      .spyOn(McpClientService.prototype, 'callTool')
      .mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] });
    jest
      .spyOn(McpClientService.prototype, 'readResource')
      .mockImplementation(async (_appId, uri) => ({ contents: [{ uri, text: 'healthy' }] }));
    jest.spyOn(McpClientService.prototype, 'getPrompt').mockResolvedValue({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hi there' } }],
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose();
    server = undefined;
  });

  async function start(entries: { tools?: ToolType[]; resources?: ResourceType[]; prompts?: PromptType[] }) {
    @App({ name: 'gateway', ...entries })
    class GatewayApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'remote-entries', version: '1.0.0' },
      apps: [GatewayApp],
      logging: { level: LogLevel.Off },
    });
    return server;
  }

  it('proxies a tool under its own name', async () => {
    const srv = await start({ tools: [Tool.remote(URL, 'echo')] });

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toEqual(['echo']);
    const result = await srv.callTool('echo', { message: 'ping' });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
    expect(callTool).toHaveBeenCalledWith(expect.any(String), 'echo', { message: 'ping' }, expect.anything());
  });

  it('proxies a resource, a resource template and a prompt', async () => {
    const srv = await start({
      resources: [Resource.remote(URL, 'status'), Resource.remote(URL, 'item')],
      prompts: [Prompt.remote(URL, 'greeting')],
    });

    expect((await srv.readResource('test://status')).contents[0]).toEqual(expect.objectContaining({ text: 'healthy' }));
    expect((await srv.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      'test://items/{id}',
    ]);
    expect((await srv.getPrompt('greeting', {})).messages[0]?.content).toEqual({ type: 'text', text: 'Hi there' });
  });

  it('connects once per URL and connection options, with options from the entry', async () => {
    const connection = {
      transportOptions: { timeout: 5000, headers: { 'x-tenant': 'acme' } },
      remoteAuth: { mode: 'static' as const, credentials: { type: 'bearer' as const, value: 'secret' } },
    };
    await start({
      tools: [Tool.remote(URL, 'echo', connection), Tool.remote(URL, 'add', connection)],
      resources: [Resource.remote(URL, 'status', connection)],
      prompts: [Prompt.remote(URL, 'greeting', connection)],
    });
    const firstAppId = connect.mock.calls[0]?.[0].appId;
    await server?.dispose();
    await start({ tools: [Tool.remote(URL, 'echo', connection)] });

    expect(connect).toHaveBeenCalledTimes(2);
    const [request] = connect.mock.calls[0] ?? [];
    expect(request).toEqual(
      expect.objectContaining({
        url: URL,
        transportType: 'http',
        transportOptions: expect.objectContaining({ timeout: 5000, headers: { 'x-tenant': 'acme' } }),
        auth: { mode: 'static', credentials: { type: 'bearer', value: 'secret' } },
      }),
    );
    expect(connect.mock.calls[1]?.[0].appId).toBe(firstAppId);
  });

  it('connects separately for entries of one URL with other credentials', async () => {
    const tenantA = { mode: 'static' as const, credentials: { type: 'bearer' as const, value: 'tenant-a' } };
    const tenantB = { mode: 'static' as const, credentials: { type: 'bearer' as const, value: 'tenant-b' } };
    await start({
      tools: [Tool.remote(URL, 'echo', { remoteAuth: tenantA }), Tool.remote(URL, 'add', { remoteAuth: tenantB })],
    });

    const requests = connect.mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.auth)).toEqual([tenantA, tenantB]);
    expect(new Set(requests.map((request) => request.appId)).size).toBe(2);
  });

  it('applies options.metadata over the remote metadata and still calls the remote tool', async () => {
    const srv = await start({
      tools: [Tool.remote(URL, 'echo', { metadata: { name: 'remote_echo', description: 'Echo, remotely' } })],
    });

    const [tool] = (await srv.listTools()).tools;
    expect(tool).toEqual(expect.objectContaining({ name: 'remote_echo', description: 'Echo, remotely' }));
    await srv.callTool('remote_echo', {});
    expect(callTool).toHaveBeenCalledWith(expect.any(String), 'echo', {}, expect.anything());
  });

  it('fails startup when the server is unreachable', async () => {
    connect.mockRejectedValue(new RemoteConnectionError('remote-entry', URL, new Error('ECONNREFUSED')));
    const startup = start({ tools: [Tool.remote(URL, 'echo')] });

    await expect(startup).rejects.toThrow(ExternalEntryLoadError);
    await expect(startup).rejects.toThrow(`Failed to load tool "echo" from ${URL}`);
  });

  it('fails startup when the server has no entry with the target name', async () => {
    const startup = start({ prompts: [Prompt.remote(URL, 'farewell')] });

    await expect(startup).rejects.toThrow(ExternalEntryNotFoundError);
    await expect(startup).rejects.toThrow(`Prompt "farewell" was not found in ${URL} (prompts there: greeting)`);
  });
});
