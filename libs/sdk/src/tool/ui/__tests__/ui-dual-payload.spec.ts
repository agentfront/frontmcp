/**
 * `ui.htmlResponsePrefix`: the dual payload, a second text block holding the call's page, for a
 * Claude client that renders no widget.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import { WIDGET_CALL_META_KEY } from '../ui-shared';

type Content = Array<{ type: string; text: string }>;

const template = (ctx: { output: { city?: string } }) => `<div id="weather">${ctx.output.city ?? ''}</div>`;
const inputSchema = { city: z.string() };

function weatherTool(name: string, ui: Record<string, unknown>) {
  @Tool({ name, inputSchema, ui: { template, escapeStringResults: false, ...ui } })
  class WeatherTool extends ToolContext {
    async execute(input: { city: string }) {
      return { city: input.city, temperature: 21 };
    }
  }
  return WeatherTool;
}

@App({
  id: 'weather',
  name: 'weather',
  tools: [
    weatherTool('auto_weather', { htmlResponsePrefix: 'Here is the weather dashboard' }),
    weatherTool('static_weather', { htmlResponsePrefix: 'Here is the weather', servingMode: 'static' }),
    weatherTool('hybrid_weather', { htmlResponsePrefix: 'Here is the weather', servingMode: 'hybrid' }),
    weatherTool('plain_weather', {}),
  ],
})
class WeatherApp {}

const CLAUDE = { meta: { [MCP_20260728_META.clientInfo]: { name: 'Claude', version: '1.0.0' } } };
const CHATGPT = { meta: { [MCP_20260728_META.clientInfo]: { name: 'ChatGPT', version: '1.0.0' } } };
const MCP_APPS_HOST = { ...CLAUDE, capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };

async function serve(config: Omit<FrontMcpConfigInput, 'info'>): Promise<TestFetchServer> {
  return createTestFetchServer({ info: { name: 'dual-payload', version: '1.0.0' }, ...config });
}

describe('ui.htmlResponsePrefix', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await serve({ apps: [WeatherApp] });
  });

  async function content(name: string, options: { meta: Record<string, unknown> }): Promise<Content> {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name, arguments: { city: 'Lisbon' } },
      options,
    );
    expect(message.error).toBeUndefined();
    return message.result?.['content'] as Content;
  }

  it('sends a Claude client the JSON, then the prefix and the page with this call’s data in an html fence', async () => {
    const [json, page] = await content('auto_weather', CLAUDE);

    expect(JSON.parse(json.text)).toEqual({ city: 'Lisbon', temperature: 21 });
    expect(page.text).toMatch(/^Here is the weather dashboard:\n\n```html\n<!DOCTYPE html>/);
    expect(page.text).toContain('<div id="weather">Lisbon</div>');
    expect(page.text.endsWith('\n```')).toBe(true);
  });

  it('renders the page for the call when the serving mode builds it once', async () => {
    const [, page] = await content('static_weather', CLAUDE);
    expect(page.text).toContain('<div id="weather">Lisbon</div>');
  });

  it("sends it for a 'hybrid' tool too, which gives a Claude client no other UI", async () => {
    const [, page] = await content('hybrid_weather', CLAUDE);
    expect(page.text).toContain('<div id="weather">Lisbon</div>');
  });

  it('sends nothing more to clients that render widgets', async () => {
    expect(await content('auto_weather', MCP_APPS_HOST)).toHaveLength(1);
    expect(await content('auto_weather', CHATGPT)).toHaveLength(1);
  });

  it("sends nothing more for a widget's own call", async () => {
    expect(await content('auto_weather', { meta: { ...CLAUDE.meta, [WIDGET_CALL_META_KEY]: true } })).toHaveLength(1);
  });

  it('leaves a tool without the option as it was', async () => {
    expect(await content('plain_weather', CLAUDE)).toHaveLength(1);
  });

  it.each([
    ['', 'must be a non-empty string'],
    ['x'.repeat(501), 'is longer than 500 characters'],
  ])('refuses the prefix %p at startup', async (htmlResponsePrefix, reason) => {
    @App({ id: 'bad-prefix', name: 'bad-prefix', tools: [weatherTool('bad_prefix', { htmlResponsePrefix })] })
    class BadPrefixApp {}

    await expect(serve({ apps: [BadPrefixApp] })).rejects.toThrow(
      `Tool "bad_prefix": \`ui.htmlResponsePrefix\` ${reason}.`,
    );
  });
});
