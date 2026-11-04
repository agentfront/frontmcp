import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { create } from '../create';
import { type DirectMcpServer } from '../direct.types';

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
const metadata = {
  customHeaders: { 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin', 'x-other': 'dropped' },
};

async function headersOf(server: DirectMcpServer): Promise<unknown> {
  try {
    return (await server.callTool('show_headers', {}, { metadata })).structuredContent;
  } finally {
    await server.dispose();
  }
}

/** An in-process call keeps the headers `http.forwardHeaders` names, as an HTTP request does (#1052). */
describe('http.forwardHeaders on in-process servers', () => {
  it('keeps them on a createDirect() call', async () => {
    const server = await FrontMcpInstance.createDirect({
      info,
      logging,
      apps: [HelpDeskApp],
      http: { forwardHeaders: ['x-acme-*'] },
    });

    expect(await headersOf(server)).toEqual({ 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin' });
  });

  it('keeps them on a create() call', async () => {
    const server = await create({ info, logging, tools: [ShowHeadersTool], http: { forwardHeaders: ['x-acme-*'] } });

    expect(await headersOf(server)).toEqual({ 'x-acme-tenant': 'eu-1', 'x-frontmcp-desk': 'berlin' });
  });

  it('keeps only x-frontmcp-* headers without forwardHeaders', async () => {
    const server = await FrontMcpInstance.createDirect({ info, logging, apps: [HelpDeskApp], http: { port: 4100 } });

    expect(await headersOf(server)).toEqual({ 'x-frontmcp-desk': 'berlin' });
  });

  it('takes only forwardHeaders from http, so a direct server stays without HTTP options', async () => {
    const server = await FrontMcpInstance.createDirect({
      info,
      logging,
      apps: [HelpDeskApp],
      http: { port: 4100, entryPath: '/desk', forwardHeaders: ['x-acme-*'] },
    });

    try {
      const { scope } = server as unknown as { scope: Scope };
      expect(scope.metadata.http?.forwardHeaders).toEqual(['x-acme-*']);
      expect(scope.metadata.http?.port).not.toBe(4100);
      expect(scope.entryPath).toBe('');
    } finally {
      await server.dispose();
    }
  });

  it('refuses a forwardHeaders glob that matches a credential header', async () => {
    await expect(
      FrontMcpInstance.createDirect({
        info,
        logging,
        apps: [HelpDeskApp],
        http: { forwardHeaders: ['authorization'] },
      }),
    ).rejects.toThrow('http.forwardHeaders');
  });
});
