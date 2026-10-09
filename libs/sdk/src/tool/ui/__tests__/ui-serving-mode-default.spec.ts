/**
 * Server- and app-level `ui.servingMode` defaults (#720).
 *
 * With the default `servingMode: 'auto'` every `tools/call` result carries the whole rendered widget
 * page in `_meta['ui/html']`, which MCP Apps hosts and ChatGPT never read (they load the widget from
 * its `ui://` resource). `auto` still resolves to `inline` in 1.9.x; instead a server opts in once
 * with `@FrontMcp({ ui: { servingMode: 'static' } })` (or an app with `@App({ ui })`), and a tool's
 * own `ui.servingMode` still wins.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcMessage,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  frontMcpMetadataSchema,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../../common';
import { resolveWidgetServingMode, WIDGET_SERVING_MODES } from '../../../common/metadata/ui-serving-mode';
import { toolServingMode, type ServingModeScope } from '../serving-mode-default';
import { describeServingModeDefault } from '../ui-option-warnings';

/** An MCP Apps host: declares the `io.modelcontextprotocol/ui` extension. */
const MCP_APPS_HOST = { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };

@Tool({
  name: 'weather',
  inputSchema: { city: z.string() },
  ui: { template: '<div id="weather-widget">forecast</div>' },
})
class WeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, temperature: 21 };
  }
}

@Tool({
  name: 'map',
  inputSchema: {},
  ui: { template: '<div id="map-widget">map</div>', servingMode: 'inline' },
})
class InlineMapTool extends ToolContext {
  async execute() {
    return { zoom: 3 };
  }
}

@App({ id: 'travel', name: 'travel', tools: [WeatherTool, InlineMapTool] })
class TravelApp {}

@Tool({ name: 'chart', inputSchema: {}, ui: { template: '<div id="chart-widget">chart</div>' } })
class ChartTool extends ToolContext {
  async execute() {
    return { points: [1, 2, 3] };
  }
}

@App({ id: 'reports', name: 'reports', tools: [ChartTool], ui: { servingMode: 'inline' } })
class InlineReportsApp {}

function meta(message: JsonRpcMessage): Record<string, unknown> {
  expect(message.error).toBeUndefined();
  return (message.result?.['_meta'] ?? {}) as Record<string, unknown>;
}

async function call(server: TestFetchServer, name: string, args: Record<string, unknown> = {}) {
  const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: args }, MCP_APPS_HOST);
  return message;
}

async function serve(config: Omit<FrontMcpConfigInput, 'info'>): Promise<TestFetchServer> {
  return createTestFetchServer({ info: { name: 'serving-mode-default', version: '1.0.0' }, ...config });
}

describe('server-level ui.servingMode (#720)', () => {
  it("leaves auto → inline as it was: without a default, tools/call carries _meta['ui/html']", async () => {
    const server = await serve({ apps: [TravelApp] });

    expect(meta(await call(server, 'weather', { city: 'Lisbon' }))['ui/html']).toEqual(
      expect.stringContaining('weather-widget'),
    );
  });

  describe("with @FrontMcp({ ui: { servingMode: 'static' } })", () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await serve({ apps: [TravelApp, InlineReportsApp], ui: { servingMode: 'static' } });
    });

    it("drops _meta['ui/html'] from the tools/call result of a tool that sets no servingMode", async () => {
      const message = await call(server, 'weather', { city: 'Lisbon' });

      expect(meta(message)['ui/html']).toBeUndefined();
      expect(message.result?.['structuredContent']).toEqual({ city: 'Lisbon', temperature: 21 });
    });

    it("still renders the page for a tool whose own ui.servingMode is 'inline'", async () => {
      expect(meta(await call(server, 'map'))['ui/html']).toEqual(expect.stringContaining('map-widget'));
    });

    it("lets an @App({ ui: { servingMode: 'inline' } }) default override the server's for its tools", async () => {
      expect(meta(await call(server, 'chart'))['ui/html']).toEqual(expect.stringContaining('chart-widget'));
    });

    it('serves the static widget from its ui:// resource, as a tool-level static mode does', async () => {
      const { message } = await rpc20260728(
        server.handler,
        'resources/read',
        { uri: 'ui://widget/weather.html' },
        MCP_APPS_HOST,
      );
      const contents = message.result?.['contents'] as Array<{ text?: string }> | undefined;

      expect(message.error).toBeUndefined();
      expect(contents?.[0]?.text).toContain('weather-widget');
    });
  });

  it("lets an @App({ ui: { servingMode: 'static' } }) default apply without a server default", async () => {
    @App({ id: 'static-travel', name: 'static-travel', tools: [WeatherTool], ui: { servingMode: 'static' } })
    class StaticTravelApp {}
    const server = await serve({ apps: [StaticTravelApp] });

    expect(meta(await call(server, 'weather', { city: 'Porto' }))['ui/html']).toBeUndefined();
  });

  it('accepts the values a tool takes, and refuses others at startup', () => {
    const config = (servingMode: unknown) => ({
      info: { name: 'x', version: '1.0.0' },
      apps: [TravelApp],
      ui: { servingMode },
    });
    for (const mode of WIDGET_SERVING_MODES) {
      expect(frontMcpMetadataSchema.safeParse(config(mode)).success).toBe(true);
    }
    expect(frontMcpMetadataSchema.safeParse(config('cached')).success).toBe(false);
  });
});

const warnings: string[] = [];

@LogTransport({ name: 'ServingModeCapture', description: 'Captures warnings' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

describe('startup notices for a default that does not do what it says', () => {
  it('warns once for the server default and once for an app default, not once per tool', async () => {
    @App({ id: 'hybrid-reports', name: 'hybrid-reports', tools: [ChartTool], ui: { servingMode: 'hybrid' } })
    class HybridReportsApp {}
    warnings.length = 0;
    await serve({
      apps: [TravelApp, HybridReportsApp],
      ui: { servingMode: 'custom-url' },
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });

    const notices = warnings.filter((line) => line.includes('ui.servingMode'));
    expect(notices).toEqual([
      expect.stringMatching(/^`@FrontMcp\(\{ ui \}\)`: `ui.servingMode: 'custom-url'` is not implemented/),
      expect.stringMatching(/^App "hybrid-reports" `@App\(\{ ui \}\)`: `ui.servingMode: 'hybrid'`/),
    ]);
  });
});

describe('toolServingMode', () => {
  type FakeTool = Parameters<typeof toolServingMode>[0];

  function tool(servingMode: string | undefined, owner: FakeTool['owner']): FakeTool {
    return { metadata: { name: 't', ui: servingMode ? { servingMode } : {} }, owner } as FakeTool;
  }

  function scope(serverMode?: string, apps: Array<{ id: string; ui?: object }> = []): ServingModeScope<FakeTool> {
    return {
      metadata: { ui: serverMode ? { servingMode: serverMode } : undefined },
      apps: { getApps: () => apps.map(({ id, ui }) => ({ id, metadata: { ui } })) },
      tools: { lineageOf: () => undefined },
    } as unknown as ServingModeScope<FakeTool>;
  }

  it("reads a server-level tool's (no app) mode from the server default", () => {
    expect(toolServingMode(tool(undefined, { kind: 'scope', id: 'gw' }), scope('static'))).toBe('static');
  });

  it('falls back to the server when the owning app is not found or sets nothing', () => {
    const owner = { kind: 'app', id: 'gone' } as const;
    expect(toolServingMode(tool(undefined, owner), scope('hybrid'))).toBe('hybrid');
    expect(toolServingMode(tool(undefined, owner), scope(undefined, [{ id: 'gone' }]))).toBe('auto');
  });

  it("prefers the tool's own mode", () => {
    expect(toolServingMode(tool('inline', { kind: 'app', id: 'a' }), scope('static'))).toBe('inline');
  });
});

describe('resolveWidgetServingMode', () => {
  it('takes the tool, then the app, then the server, then auto', () => {
    expect(resolveWidgetServingMode('inline', 'static', 'hybrid')).toBe('inline');
    expect(resolveWidgetServingMode(undefined, 'static', 'hybrid')).toBe('static');
    expect(resolveWidgetServingMode(undefined, undefined, 'hybrid')).toBe('hybrid');
    expect(resolveWidgetServingMode(undefined)).toBe('auto');
  });
});

describe('describeServingModeDefault', () => {
  it('says once that an unimplemented default serves inline', () => {
    expect(describeServingModeDefault('`@FrontMcp({ ui })`', 'custom-url')).toEqual([
      expect.stringContaining("`ui.servingMode: 'custom-url'` is not implemented"),
    ]);
  });

  it('explains what a hybrid default sends', () => {
    expect(describeServingModeDefault('App "a" `@App({ ui })`', 'hybrid')[0]).toContain("_meta['ui/component']");
  });

  it('has nothing to say about the modes that do what they say, or no default', () => {
    expect(describeServingModeDefault('x', 'static')).toEqual([]);
    expect(describeServingModeDefault('x', undefined)).toEqual([]);
  });
});
