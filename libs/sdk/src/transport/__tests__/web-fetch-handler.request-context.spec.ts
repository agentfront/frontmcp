import 'reflect-metadata';

import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigType } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'request_info', inputSchema: {} })
class RequestInfoTool extends ToolContext {
  async execute() {
    return {
      metadata: this.context.metadata,
      traceId: this.context.traceContext.traceId,
      clientInfo: this.clientInfo ?? null,
      platform: this.platform,
    };
  }
}

@App({ id: 'inspect', name: 'Inspect', tools: [RequestInfoTool] })
class InspectApp {}

interface RequestInfoResult {
  metadata: { userAgent?: string; customHeaders: Record<string, string> };
  traceId: string;
  clientInfo: { name: string; version: string } | null;
  platform: string;
}

const incomingTraceId = '0af7651916cd43dd8448eb211c80319c';
const incomingTraceparent = `00-${incomingTraceId}-b7ad6b7169203331-01`;

describe('web fetch handler request context', () => {
  let server: TestFetchServer;

  async function callRequestInfo(
    headers: Record<string, string> = {},
    meta: Record<string, unknown> = {},
  ): Promise<RequestInfoResult> {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'request_info', arguments: {} },
      { headers, meta },
    );
    return message.result?.['structuredContent'] as unknown as RequestInfoResult;
  }

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'request-context', version: '1.0.0' }, apps: [InspectApp] });
  });

  it('exposes the request user-agent header as this.context.metadata.userAgent', async () => {
    const result = await callRequestInfo({ 'user-agent': 'spec-agent/2.3.4' });

    expect(result.metadata.userAgent).toBe('spec-agent/2.3.4');
  });

  it('exposes x-frontmcp-* request headers in this.context.metadata.customHeaders', async () => {
    const result = await callRequestInfo({ 'x-frontmcp-tenant': 'acme' });

    expect(result.metadata.customHeaders).toEqual({ 'x-frontmcp-tenant': 'acme' });
  });

  it('continues the incoming traceparent trace in this.context.traceContext', async () => {
    const result = await callRequestInfo({ traceparent: incomingTraceparent });

    expect(result.traceId).toBe(incomingTraceId);
  });

  it('exposes the 2026-07-28 _meta clientInfo as this.clientInfo', async () => {
    const result = await callRequestInfo(
      {},
      { [MCP_20260728_META.clientInfo]: { name: 'meta-client', version: '4.5.6' } },
    );

    expect(result.clientInfo).toEqual({ name: 'meta-client', version: '4.5.6' });
  });

  it('detects this.platform from the 2026-07-28 _meta clientInfo name', async () => {
    const result = await callRequestInfo(
      {},
      { [MCP_20260728_META.clientInfo]: { name: 'cursor-vscode', version: '1.0.0' } },
    );

    expect(result.platform).toBe('cursor');
  });

  it('serves a 2025-06-18 client statelessly, without an mcp-session-id', async () => {
    const postLegacy = (body: unknown) =>
      server.handler(
        new Request('http://localhost/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify(body),
        }),
      );

    const initialize = await postLegacy({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } },
    });
    await initialize.text();
    const toolCall = await postLegacy({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'request_info', arguments: {} },
    });
    const toolCallBody = await toolCall.text();

    expect({
      initializeStatus: initialize.status,
      sessionId: initialize.headers.get('mcp-session-id'),
      toolCallStatus: toolCall.status,
      toolCallSucceeded: toolCallBody.includes('"result"') && !toolCallBody.includes('"isError":true'),
    }).toEqual({ initializeStatus: 200, sessionId: null, toolCallStatus: 200, toolCallSucceeded: true });
  });
});

describe('FrontMcpInstance.createFetchHandler with the config as written for @FrontMcp()', () => {
  it('answers tools/list with HTTP 200 without a pre-parsed config', async () => {
    const rawConfig = {
      info: { name: 'raw-config', version: '1.0.0' },
      apps: [InspectApp],
      logging: { level: LogLevel.Off },
    };
    const handler = await FrontMcpInstance.createFetchHandler(rawConfig as unknown as FrontMcpConfigType);

    const { status, message } = await rpc20260728(handler, 'tools/list');

    expect({ status, body: message }).toMatchObject({
      status: 200,
      body: { result: { tools: [expect.objectContaining({ name: 'request_info' })] } },
    });
  });
});
