/**
 * `servingMode: 'direct-url'`: the page compiled at startup is served on a route of the server, and
 * the widget's `ui://` resource is a page that frames that route.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcMessage,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Skill, SkillContext, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import { InvalidToolUiConfigError } from '../../../errors';
import { handleUIResourceRead } from '../ui-resource.handler';
import { ToolUIRegistry } from '../ui-shared';

const MCP_APPS_HOST = { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };

@Tool({
  name: 'weather',
  inputSchema: { city: z.string() },
  ui: {
    template: '<div id="weather-widget">forecast</div>',
    servingMode: 'direct-url',
    csp: { connectDomains: ['https://api.weather.example'] },
  },
})
class WeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, temperature: 21 };
  }
}

@Tool({
  name: 'radar',
  inputSchema: {},
  ui: { template: '<div id="radar-widget">radar</div>', servingMode: 'direct-url', directPath: '/maps/radar' },
})
class RadarTool extends ToolContext {
  async execute() {
    return { frames: 3 };
  }
}

@Tool({ name: 'badge', inputSchema: {}, ui: { template: '<div id="badge-widget">badge</div>' } })
class BadgeTool extends ToolContext {
  async execute() {
    return { label: 'ok' };
  }
}

@App({ id: 'forecast', name: 'forecast', tools: [WeatherTool, RadarTool, BadgeTool] })
class ForecastApp {}

async function serve(config: Omit<FrontMcpConfigInput, 'info'>): Promise<TestFetchServer> {
  return createTestFetchServer({ info: { name: 'direct-url', version: '1.0.0' }, ...config });
}

function result(message: JsonRpcMessage): Record<string, unknown> {
  expect(message.error).toBeUndefined();
  return message.result ?? {};
}

async function readWidget(server: TestFetchServer, uri: string, headers?: Record<string, string>) {
  const { message } = await rpc20260728(server.handler, 'resources/read', { uri }, { ...MCP_APPS_HOST, headers });
  return (result(message)['contents'] as Array<{ text: string; _meta?: Record<string, any> }>)[0];
}

async function get(server: TestFetchServer, path: string): Promise<Response> {
  return server.handler(new Request(`http://localhost${path}`, { headers: { accept: 'text/html' } }));
}

describe("servingMode: 'direct-url'", () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serve({ apps: [ForecastApp] });
  });

  it('sends no page in the tools/call result, only the data', async () => {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'weather', arguments: { city: 'Lisbon' } },
      MCP_APPS_HOST,
    );

    const answer = result(message);
    expect((answer['_meta'] as Record<string, unknown> | undefined)?.['ui/html']).toBeUndefined();
    expect(answer['structuredContent']).toEqual({ city: 'Lisbon', temperature: 21 });
  });

  it('serves the page compiled at startup on /widgets/{toolName}, without a call’s data', async () => {
    const response = await get(server, '/widgets/weather');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const page = await response.text();
    expect(page).toContain('weather-widget');
    expect(page).toContain('window.__mcpToolOutput = null;');
  });

  it('lets any host frame the page', async () => {
    const response = await get(server, '/widgets/weather');

    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors *');
    expect(response.headers.get('x-frame-options')).toBeNull();
  });

  it('serves the page on the directPath a tool sets', async () => {
    const response = await get(server, '/maps/radar');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('radar-widget');
    expect((await get(server, '/widgets/radar')).status).toBe(404);
  });

  it('makes the ui:// resource a page that frames the route, on the origin the read came to', async () => {
    const content = await readWidget(server, 'ui://widget/weather.html', { host: 'mcp.example.com' });

    expect(content.text).toContain('<iframe id="frontmcp-widget" src="http://mcp.example.com/widgets/weather"');
    expect(content.text).not.toContain('weather-widget');
  });

  it("declares the route's origin as a frame, beside the tool's own csp", async () => {
    const { _meta } = await readWidget(server, 'ui://widget/weather.html');

    expect(_meta?.['ui']['csp']).toEqual(
      expect.objectContaining({
        connectDomains: ['https://api.weather.example'],
        resourceDomains: [],
        frameDomains: ['http://localhost'],
      }),
    );
    expect(_meta?.['openai/widgetCSP']).toEqual({
      connect_domains: ['https://api.weather.example'],
      resource_domains: [],
      frame_domains: ['http://localhost'],
    });
  });

  it('leaves a widget that sets no serving option as it was', async () => {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'badge', arguments: {} },
      MCP_APPS_HOST,
    );
    expect((result(message)['_meta'] as Record<string, unknown>)['ui/html']).toEqual(
      expect.stringContaining('badge-widget'),
    );

    const content = await readWidget(server, 'ui://widget/badge.html');
    expect(content.text).not.toContain('frontmcp-widget');
    expect(content._meta).toBeUndefined();
    expect((await get(server, '/widgets/badge')).status).toBe(404);
  });
});

describe('the URL the ui:// resource frames', () => {
  const previous = process.env['FRONTMCP_PUBLIC_URL'];

  afterEach(() => {
    if (previous === undefined) delete process.env['FRONTMCP_PUBLIC_URL'];
    else process.env['FRONTMCP_PUBLIC_URL'] = previous;
  });

  it('starts with FRONTMCP_PUBLIC_URL when it is set, whatever host the read came to', async () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://widgets.example.com/';
    const server = await serve({ apps: [ForecastApp] });

    const content = await readWidget(server, 'ui://widget/radar.html', { host: 'attacker.example' });

    expect(content.text).toContain('src="https://widgets.example.com/maps/radar"');
    expect(content._meta?.['ui']['csp']['frameDomains']).toEqual(['https://widgets.example.com']);
  });

  it('is unknown outside an HTTP request without FRONTMCP_PUBLIC_URL, and the read fails saying so', () => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    const registry = new ToolUIRegistry();
    registry.registerTool('weather');
    registry.registerWidgetUrl('weather', { servingMode: 'direct-url', path: '/widgets/weather' });

    expect(handleUIResourceRead('ui://widget/weather.html', registry)).toEqual({
      handled: true,
      error: expect.stringContaining('set FRONTMCP_PUBLIC_URL'),
    });
  });
});

describe('server and app defaults', () => {
  it("serves every tool that inherits the server's 'direct-url' on its default route", async () => {
    const server = await serve({ apps: [ForecastApp], ui: { servingMode: 'direct-url' } });

    expect(await (await get(server, '/widgets/badge')).text()).toContain('badge-widget');
    expect((await readWidget(server, 'ui://widget/badge.html')).text).toContain('src="http://localhost/widgets/badge"');
  });

  it("serves the tools of an app whose default is 'direct-url'", async () => {
    @App({ id: 'badges', name: 'badges', tools: [BadgeTool], ui: { servingMode: 'direct-url' } })
    class BadgesApp {}
    const server = await serve({ apps: [BadgesApp] });

    expect((await get(server, '/widgets/badge')).status).toBe(200);
  });
});

describe('startup refusals', () => {
  function toolWithPath(name: string, directPath: string) {
    @Tool({ name, inputSchema: {}, ui: { template: '<p>x</p>', servingMode: 'direct-url', directPath } })
    class PathTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    return PathTool;
  }

  function appOf(...tools: ReturnType<typeof toolWithPath>[]) {
    @App({ id: 'paths', name: 'paths', tools })
    class PathsApp {}
    return PathsApp;
  }

  it.each([
    ['/healthz', 'a FrontMCP endpoint'],
    ['/metrics', 'a FrontMCP endpoint'],
    ['/oauth/widget', "FrontMCP's /oauth routes"],
    ['/.well-known/widget', "FrontMCP's /.well-known routes"],
    ['/_frontmcp/widget', "FrontMCP's /_frontmcp routes"],
  ])('refuses the directPath %s, which collides with %s', async (directPath, what) => {
    await expect(serve({ apps: [appOf(toolWithPath('clash', directPath))] })).rejects.toThrow(
      `Tool "clash": its widget route GET ${directPath} collides with ${what}. Set a different \`ui.directPath\`.`,
    );
  });

  it('refuses two widgets on one route, compared as Express matches them', async () => {
    const error = await serve({
      apps: [appOf(toolWithPath('first', '/widgets/shared'), toolWithPath('second', '/Widgets/Shared/'))],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidToolUiConfigError);
    expect((error as InvalidToolUiConfigError).problems).toEqual([
      'Tool "second": its widget route GET /Widgets/Shared collides with the widget route of tool "first". ' +
        'Set a different `ui.directPath`.',
    ]);
  });

  it('refuses a route the server already serves from http.routes', async () => {
    await expect(
      serve({
        apps: [appOf(toolWithPath('report', '/reports/today'))],
        http: { routes: [{ method: 'GET', path: '/reports/:day', handler: (_req, res) => res.status(200).json({}) }] },
      }),
    ).rejects.toThrow('collides with a route of the server (GET /reports/:day)');
  });

  it('refuses a path an endpoint of the server answers, such as /llm.txt with skills on', async () => {
    @Skill({ name: 'guide', description: 'A guide', instructions: 'Steps.' })
    class GuideSkill extends SkillContext {}
    @App({ id: 'guides', name: 'guides', tools: [toolWithPath('llm', '/llm.txt')], skills: [GuideSkill] })
    class GuidesApp {}

    await expect(serve({ apps: [GuidesApp], skillsConfig: { enabled: true } })).rejects.toThrow(
      /Tool "llm": its widget route GET \/llm\.txt collides with the "[^"]+" endpoint/,
    );
  });

  it("refuses a directPath on a tool that isn't served 'direct-url'", async () => {
    @Tool({ name: 'inline_path', inputSchema: {}, ui: { template: '<p>x</p>', directPath: '/widgets/x' } })
    class InlinePathTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    @App({ id: 'inline-path', name: 'inline-path', tools: [InlinePathTool] })
    class InlinePathApp {}

    await expect(serve({ apps: [InlinePathApp] })).rejects.toThrow(
      'Tool "inline_path": `ui.directPath` is set, but the widget is served \'auto\', so nothing serves that path.',
    );
  });

  it('refuses an invalid directPath', async () => {
    await expect(serve({ apps: [appOf(toolWithPath('bad', '/widgets/../admin'))] })).rejects.toThrow(
      'Tool "bad": `ui.directPath` "/widgets/../admin"',
    );
  });
});
