/**
 * An in-process call keeps the request headers `http.forwardHeaders` names in `customHeaders`, as an HTTP
 * request does (#1052): `createDirect()` and `create()` never listen, but they take `http.forwardHeaders`.
 */
import { App, create, FrontMcpInstance, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

@Tool({ name: 'show_headers', inputSchema: {} })
class ShowHeadersTool extends ToolContext {
  async execute() {
    return this.context.metadata.customHeaders;
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [ShowHeadersTool] })
class HelpDeskApp {}

const info = { name: 'help-desk', version: '1.0.0' };
const logging = { level: LogLevel.Off };
const http = { forwardHeaders: ['x-acme-*'] };
const metadata = { customHeaders: { 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin', 'x-other': 'dropped' } };

async function headersOf(server: DirectMcpServer): Promise<unknown> {
  try {
    return (await server.callTool('show_headers', {}, { metadata })).structuredContent;
  } finally {
    await server.dispose();
  }
}

describe('http.forwardHeaders on in-process servers', () => {
  it('keeps the named headers on a createDirect() call', async () => {
    const server = await FrontMcpInstance.createDirect({ info, logging, apps: [HelpDeskApp], http });

    expect(await headersOf(server)).toEqual({ 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin' });
  });

  it('keeps the named headers on a create() call', async () => {
    const server = await create({ info, logging, tools: [ShowHeadersTool], http });

    expect(await headersOf(server)).toEqual({ 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin' });
  });
});
