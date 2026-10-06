import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type DirectMcpServer } from '../direct.types';

@Tool({ name: 'request_metadata', inputSchema: {} })
class RequestMetadataTool extends ToolContext {
  async execute() {
    const { metadata, traceContext } = this.context;
    return {
      customHeaders: metadata.customHeaders,
      userAgent: metadata.userAgent ?? null,
      clientIp: metadata.clientIp ?? null,
      traceId: traceContext.traceId,
    };
  }
}

let nestedServer: DirectMcpServer | undefined;

@Tool({ name: 'nested_request_metadata', inputSchema: {} })
class NestedRequestMetadataTool extends ToolContext {
  async execute() {
    if (!nestedServer) throw new Error('direct server is not ready');
    const nested = await nestedServer.callTool(
      'request_metadata',
      {},
      {
        metadata: { userAgent: 'nested-job/1.0', customHeaders: { 'x-frontmcp-tenant': 'inner' } },
      },
    );
    return nested.structuredContent ?? {};
  }
}

@App({ id: 'desk', name: 'Desk', tools: [RequestMetadataTool, NestedRequestMetadataTool] })
class DeskApp {}

interface RequestMetadataResult {
  customHeaders: Record<string, string>;
  userAgent: string | null;
  clientIp: string | null;
  traceId: string;
}

describe('DirectCallOptions.metadata reaches the request context (#709)', () => {
  let server: DirectMcpServer;

  async function metadataOf(options?: Parameters<DirectMcpServer['callTool']>[2]): Promise<RequestMetadataResult> {
    const response = await server.callTool('request_metadata', {}, options);
    return response.structuredContent as unknown as RequestMetadataResult;
  }

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'direct-request-metadata', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    nestedServer = server;
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('carries x-frontmcp-* custom headers, the user agent and the client IP', async () => {
    const result = await metadataOf({
      metadata: {
        userAgent: 'billing-batch/2.1',
        clientIp: '10.20.30.40',
        customHeaders: { 'X-FrontMCP-Disable-Cache': 'true' },
      },
    });

    expect(result.customHeaders).toEqual({ 'x-frontmcp-disable-cache': 'true' });
    expect(result.userAgent).toBe('billing-batch/2.1');
    expect(result.clientIp).toBe('10.20.30.40');
  });

  it('keeps only x-frontmcp-* keys in customHeaders', async () => {
    const result = await metadataOf({
      metadata: { customHeaders: { authorization: 'Bearer leaked', 'x-frontmcp-tenant': 'acme' } },
    });

    expect(result.customHeaders).toEqual({ 'x-frontmcp-tenant': 'acme' });
  });

  it('drops a client IP that is not an IP address', async () => {
    expect((await metadataOf({ metadata: { clientIp: 'not-an-ip' } })).clientIp).toBeNull();
  });

  it('continues the trace named by an x-frontmcp-trace-id header', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

    const result = await metadataOf({ metadata: { customHeaders: { 'x-frontmcp-trace-id': traceId } } });

    expect(result.traceId).toBe(traceId);
  });

  it("gives a direct call made inside another request its own metadata, not the outer call's", async () => {
    const response = await server.callTool(
      'nested_request_metadata',
      {},
      { metadata: { userAgent: 'outer-batch/1.0', customHeaders: { 'x-frontmcp-tenant': 'outer' } } },
    );
    const result = response.structuredContent as unknown as RequestMetadataResult;

    expect(result.userAgent).toBe('nested-job/1.0');
    expect(result.customHeaders).toEqual({ 'x-frontmcp-tenant': 'inner' });
  });

  it('leaves the metadata empty when the call carries none', async () => {
    const result = await metadataOf();

    expect(result.customHeaders).toEqual({});
    expect(result.userAgent).toBeNull();
    expect(result.clientIp).toBeNull();
  });
});
