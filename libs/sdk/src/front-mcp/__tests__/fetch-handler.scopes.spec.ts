import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { TEST_CLIENT_INFO } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

function namedTool(name: string) {
  @Tool({ name, inputSchema: {} })
  class NamedTool extends ToolContext {
    async execute() {
      return { tool: name };
    }
  }
  return NamedTool;
}

@App({ id: 'billing', name: 'Billing', tools: [namedTool('charge')] })
class BillingApp {}

@App({ id: 'support', name: 'Support', tools: [namedTool('open_ticket')] })
class SupportApp {}

@App({ id: 'console', name: 'Console', standalone: true, tools: [namedTool('inspect')] })
class ConsoleApp {}

async function toolNamesAt(handler: (request: Request) => Promise<Response>, path: string): Promise<string[]> {
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: TEST_CLIENT_INFO,
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
  const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
  return (body.result?.tools ?? []).map((tool) => tool.name).sort();
}

describe('createFetchHandler() with several scopes', () => {
  it('serves every app of a splitByApp server at its own path', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-fetch', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      splitByApp: true,
      logging: { level: LogLevel.Off },
    });

    await expect(toolNamesAt(handler, '/billing')).resolves.toEqual(['charge']);
    await expect(toolNamesAt(handler, '/support')).resolves.toEqual(['open_ticket']);
  });

  it('serves a standalone app at its own path, next to the server', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'standalone-fetch', version: '1.0.0' },
      apps: [BillingApp, ConsoleApp],
      logging: { level: LogLevel.Off },
    });

    await expect(toolNamesAt(handler, '/')).resolves.toEqual(['charge']);
    await expect(toolNamesAt(handler, '/console')).resolves.toEqual(['inspect']);
  });
});
