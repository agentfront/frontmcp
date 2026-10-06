/**
 * ToolUIRegistry behaviour reported in #681:
 *  - A widget compiled at startup (served from `ui://widget/{tool}.html`) carries no call's data,
 *    so the page injects `null` rather than a `{}` the bridge would take for the result; template
 *    functions still get objects.
 *  - A React component reference as `ui.template` is warned about once (the startup compile), not
 *    on every call.
 *  - `ui.csp` origins: `wss://` reaches the page's CSP, an origin the page CSP cannot list is left
 *    out without a warning on every render, and the resource `_meta` keeps what was written.
 */
import { ToolUIRegistry } from '../ui-shared';

function cspOf(html: string): string {
  return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
}

function connectSrc(html: string): string[] {
  const directive = cspOf(html)
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src '));
  return directive ? directive.split(' ').slice(1) : [];
}

describe('ToolUIRegistry compiled widgets (#681)', () => {
  it('injects no call data into a widget compiled at startup, while the template gets objects', async () => {
    const registry = new ToolUIRegistry(undefined, { logger: { warn: jest.fn() } });
    const template = jest.fn((ctx: { input: unknown; output: unknown }) => `<p>${JSON.stringify(ctx.output)}</p>`);

    await registry.compileStaticWidgetAsync({ toolName: 'weather', template, uiConfig: { template } });
    const html = registry.getStaticWidget('weather') ?? '';

    expect(html).toContain('window.__mcpToolInput = null;');
    expect(html).toContain('window.__mcpToolOutput = null;');
    expect(template).toHaveBeenCalledWith(expect.objectContaining({ input: {}, output: {} }));
  });

  it('still embeds the call data in a per-call render', async () => {
    const registry = new ToolUIRegistry(undefined, { logger: { warn: jest.fn() } });
    const template = (ctx: { output: unknown }) => `<p>${JSON.stringify(ctx.output)}</p>`;

    const { meta } = await registry.renderAndRegisterAsync({
      toolName: 'weather',
      input: { city: 'Oslo' },
      output: { temp: 21 },
      uiConfig: { template },
    });

    expect(meta['ui/html']).toContain('window.__mcpToolOutput = {"temp":21};');
  });

  it('warns about a React component reference once, at the startup compile', async () => {
    const warn = jest.fn();
    const registry = new ToolUIRegistry(undefined, { logger: { warn } });
    function WeatherCard(): never {
      throw new Error('Invalid hook call');
    }
    const uiConfig = { template: WeatherCard };

    await registry.compileLeanWidgetAsync({ toolName: 'react_weather', uiConfig, template: WeatherCard });
    for (let call = 0; call < 3; call++) {
      await registry.renderAndRegisterAsync({ toolName: 'react_weather', input: {}, output: { call }, uiConfig });
    }

    const componentWarnings = warn.mock.calls.filter(([message]) => String(message).includes('React component'));
    expect(componentWarnings).toHaveLength(1);
    expect(componentWarnings[0][0]).toContain('react_weather');
  });

  it('warns at startup for an inline-mode tool whose lean shell never renders the template (#769)', async () => {
    const warn = jest.fn();
    const registry = new ToolUIRegistry(undefined, { logger: { warn } });
    class InlineCard {
      render(): null {
        return null;
      }
    }
    const uiConfig = { template: InlineCard };

    registry.checkTemplate('inline_card', InlineCard);
    await registry.compileLeanWidgetAsync({ toolName: 'inline_card', uiConfig });
    const componentWarningsAtStartup = warn.mock.calls.filter(([message]) =>
      String(message).includes('React component'),
    );
    expect(componentWarningsAtStartup).toHaveLength(1);

    await registry.renderAndRegisterAsync({ toolName: 'inline_card', input: {}, output: {}, uiConfig });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('React component'))).toHaveLength(1);
  });

  describe('ui.csp', () => {
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
      consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      consoleWarn.mockRestore();
    });

    const csp = {
      connectDomains: ['wss://live.example.com', 'ftp://files.example.com', 'https://api.example.com'],
      resourceDomains: ['cdn.example.com'],
    };

    it('lets the page connect to wss:// and keeps the CDNs in connect-src', async () => {
      const registry = new ToolUIRegistry();

      const { meta } = await registry.renderAndRegisterAsync({
        toolName: 'live',
        input: {},
        output: {},
        uiConfig: { template: '<p></p>', csp },
      });
      const sources = connectSrc(String(meta['ui/html']));

      expect(sources).toEqual(
        expect.arrayContaining(['wss://live.example.com', 'https://api.example.com', 'https://cdn.jsdelivr.net']),
      );
      expect(sources).not.toContain('ftp://files.example.com');
    });

    it('leaves invalid origins out of the page without warning on every render', async () => {
      const registry = new ToolUIRegistry();

      for (let call = 0; call < 3; call++) {
        await registry.renderAndRegisterAsync({
          toolName: 'live',
          input: {},
          output: {},
          uiConfig: { template: '<p></p>', csp },
        });
      }

      expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('keeps the origins as written in the resource _meta, for the host', async () => {
      const registry = new ToolUIRegistry();

      await registry.compileStaticWidgetAsync({
        toolName: 'live',
        template: '<p></p>',
        uiConfig: { template: '<p></p>', csp },
      });

      expect(registry.getResourceMeta('live')?.csp).toEqual(csp);
    });
  });
});
