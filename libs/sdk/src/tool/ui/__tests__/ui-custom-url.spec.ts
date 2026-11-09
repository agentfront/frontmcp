/**
 * `servingMode: 'custom-url'`: the page at `customWidgetUrl` is the widget, and the widget's `ui://`
 * resource is a page that frames it.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcMessage,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';

const MCP_APPS_HOST = { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };
const WIDGET_URL = 'https://widgets.example.com/forecast/index.html?v=3';

@Tool({
  name: 'forecast',
  inputSchema: { city: z.string() },
  ui: {
    template: '<div id="never-rendered">x</div>',
    servingMode: 'custom-url',
    customWidgetUrl: WIDGET_URL,
    csp: { connectDomains: ['https://api.forecast.example'] },
    prefersBorder: true,
  },
})
class ForecastTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, high: 24 };
  }
}

@App({ id: 'forecast-app', name: 'forecast-app', tools: [ForecastTool] })
class ForecastApp {}

async function serve(config: Omit<FrontMcpConfigInput, 'info'>): Promise<TestFetchServer> {
  return createTestFetchServer({ info: { name: 'custom-url', version: '1.0.0' }, ...config });
}

function result(message: JsonRpcMessage): Record<string, unknown> {
  expect(message.error).toBeUndefined();
  return message.result ?? {};
}

describe("servingMode: 'custom-url'", () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serve({ apps: [ForecastApp] });
  });

  it('sends no page in the tools/call result, only the data', async () => {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'forecast', arguments: { city: 'Lisbon' } },
      MCP_APPS_HOST,
    );

    const answer = result(message);
    expect((answer['_meta'] as Record<string, unknown> | undefined)?.['ui/html']).toBeUndefined();
    expect(answer['structuredContent']).toEqual({ city: 'Lisbon', high: 24 });
  });

  it('makes the ui:// resource a page that frames the URL as written, whatever host the read came to', async () => {
    const { message } = await rpc20260728(
      server.handler,
      'resources/read',
      { uri: 'ui://widget/forecast.html' },
      { ...MCP_APPS_HOST, headers: { host: 'mcp.example.com' } },
    );
    const [content] = result(message)['contents'] as Array<{ text: string; _meta?: Record<string, any> }>;

    expect(content.text).toContain(`<iframe id="frontmcp-widget" src="${WIDGET_URL}"`);
    expect(content.text).not.toContain('never-rendered');
    expect(content._meta?.['ui']).toEqual(
      expect.objectContaining({
        prefersBorder: true,
        csp: expect.objectContaining({
          connectDomains: ['https://api.forecast.example'],
          frameDomains: ['https://widgets.example.com'],
        }),
      }),
    );
    expect(content._meta?.['openai/widgetCSP']).toEqual({
      connect_domains: ['https://api.forecast.example'],
      resource_domains: [],
      frame_domains: ['https://widgets.example.com'],
    });
  });

  it('opens no route on the server', async () => {
    const response = await server.handler(new Request('http://localhost/widgets/forecast'));
    expect(response.status).toBe(404);
  });
});

describe("'custom-url' as a server or app default", () => {
  it('serves each inheriting tool from its own customWidgetUrl', async () => {
    @Tool({
      name: 'radar',
      inputSchema: {},
      ui: { template: '', customWidgetUrl: 'https://cdn.example.com/radar.html' },
    })
    class RadarTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    @App({ id: 'radar-app', name: 'radar-app', tools: [RadarTool], ui: { servingMode: 'custom-url' } })
    class RadarApp {}

    const server = await serve({ apps: [RadarApp] });
    const { message } = await rpc20260728(
      server.handler,
      'resources/read',
      { uri: 'ui://widget/radar.html' },
      MCP_APPS_HOST,
    );

    expect((result(message)['contents'] as Array<{ text: string }>)[0].text).toContain(
      'src="https://cdn.example.com/radar.html"',
    );
  });

  it('refuses to start when an inheriting tool has no customWidgetUrl', async () => {
    @Tool({ name: 'plain', inputSchema: {}, ui: { template: '<p>x</p>' } })
    class PlainTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    @App({ id: 'plain-app', name: 'plain-app', tools: [PlainTool] })
    class PlainApp {}

    await expect(serve({ apps: [PlainApp], ui: { servingMode: 'custom-url' } })).rejects.toThrow(
      'Tool "plain": `ui.servingMode: \'custom-url\'` needs `ui.customWidgetUrl`, the URL of the widget page.',
    );
  });

  it('refuses a URL with a token placeholder, without repeating the URL', async () => {
    @Tool({
      name: 'tokened',
      inputSchema: {},
      ui: { template: '', servingMode: 'custom-url', customWidgetUrl: 'https://cdn.example.com/w.html?t={token}' },
    })
    class TokenedTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    @App({ id: 'tokened-app', name: 'tokened-app', tools: [TokenedTool] })
    class TokenedApp {}

    const error = await serve({ apps: [TokenedApp] }).catch((caught: Error) => caught);
    expect(String(error)).toContain('Tool "tokened": `ui.customWidgetUrl` has a `{…}` placeholder');
    expect(String(error)).not.toContain('cdn.example.com');
  });
});
