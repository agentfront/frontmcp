import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../common';

@Tool({ name: 'connect_github', inputSchema: {} })
class ConnectGithubTool extends ToolContext {
  async execute() {
    const result = await this.elicit('Authorize GitHub access', z.object({}), {
      mode: 'url',
      url: 'https://auth.example.com/github?state=opaque-1',
      elicitationId: 'elicit-github-1',
    });
    return { status: result.status };
  }
}

@Tool({ name: 'connect_without_url', inputSchema: {} })
class ConnectWithoutUrlTool extends ToolContext {
  async execute() {
    const result = await this.elicit('Authorize', z.object({}), { mode: 'url', elicitationId: 'elicit-2' });
    return { status: result.status };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ConnectGithubTool, ConnectWithoutUrlTool] })
class DeskApp {}

describe('URL-mode elicitation under MCP 2026-07-28', () => {
  const config = {
    info: { name: 'url-mode-elicitation', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    elicitation: { enabled: true },
  };

  it('sends the URL and the elicitationId in the input request', async () => {
    const server = await createTestFetchServer(config);
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'connect_github', arguments: {} },
      { capabilities: { elicitation: { url: {} } } },
    );

    const inputRequests = (message.result?.['inputRequests'] ?? {}) as Record<string, { params: unknown }>;
    expect(Object.values(inputRequests)[0]?.params).toEqual(
      expect.objectContaining({
        mode: 'url',
        message: 'Authorize GitHub access',
        url: 'https://auth.example.com/github?state=opaque-1',
        elicitationId: 'elicit-github-1',
      }),
    );
  });

  it('refuses a URL-mode elicitation without a url', async () => {
    const server = await createTestFetchServer(config);
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'connect_without_url', arguments: {} },
      { capabilities: { elicitation: { url: {} } } },
    );

    expect(JSON.stringify(message)).toContain('url is required when mode is \\"url\\"');
  });
});
