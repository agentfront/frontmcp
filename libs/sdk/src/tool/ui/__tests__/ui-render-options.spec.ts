/**
 * A tool's `ui` rendering options reach the renderer, and the server refuses to start a tool whose
 * template cannot take one.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { ToolUiConfigurationError } from '../../../errors/tool-ui.errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { ToolUIRegistry } from '../ui-shared';

const MARKUP = '<p onclick="steal()">hi<script>steal()</script><a href="javascript:steal()">x</a></p>';

function body(meta: Record<string, unknown>): string {
  return /<body[^>]*>([\s\S]*)<\/body>/.exec(String(meta['ui/html']))?.[1] ?? '';
}

describe('ToolUIRegistry rendering options', () => {
  it('sanitizes a call render and a widget compiled at startup when contentSecurity is set', async () => {
    const registry = new ToolUIRegistry();
    const uiConfig = { template: MARKUP, contentSecurity: {} };

    const { meta } = await registry.renderAndRegisterAsync({ toolName: 'card', uiConfig });
    expect(body(meta).trim()).toBe('<p>hi<a>x</a></p>');

    await registry.compileStaticWidgetAsync({ toolName: 'card', template: MARKUP, uiConfig });
    expect(registry.getStaticWidget('card')).toContain('<p>hi<a>x</a></p>');
  });

  it('renders the markup as written without contentSecurity', async () => {
    const { meta } = await new ToolUIRegistry().renderAndRegisterAsync({
      toolName: 'card',
      uiConfig: { template: MARKUP },
    });
    expect(body(meta).trim()).toBe(MARKUP);
  });

  it('refuses contentSecurity on a { file } widget', async () => {
    const check = new ToolUIRegistry().checkRenderOptions('weather', {
      template: { file: './weather.widget.tsx' },
      contentSecurity: { allowInlineScripts: true },
    });
    await expect(check).rejects.toBeInstanceOf(ToolUiConfigurationError);
    await expect(check).rejects.toThrow('Tool "weather": `ui.contentSecurity` sanitizes the markup');
  });

  it('converts a Markdown template with runtimeOptions.markdown, in a call render and at startup', async () => {
    const registry = new ToolUIRegistry();
    const uiConfig = {
      template: '| a | b |\n|---|---|\n| 1 | ~~2~~ |\n\n```json\n{"a": 1}\n```',
      runtimeOptions: { markdown: { gfm: true, highlightTheme: 'github' } },
    };
    await registry.checkRenderOptions('report', uiConfig);

    const { meta } = await registry.renderAndRegisterAsync({ toolName: 'report', uiConfig });
    expect(body(meta)).toContain('<td>1</td><td><del>2</del></td>');
    expect(body(meta)).toContain('<code class="hljs language-json">');

    await registry.compileStaticWidgetAsync({ toolName: 'report', template: uiConfig.template, uiConfig });
    expect(registry.getStaticWidget('report')).toContain('<td>1</td><td><del>2</del></td>');
  });

  it('refuses runtimeOptions.markdown on a template that is not Markdown, and a theme that does not exist', async () => {
    const registry = new ToolUIRegistry();
    await expect(
      registry.checkRenderOptions('report', { template: '<p>x</p>', runtimeOptions: { markdown: { gfm: true } } }),
    ).rejects.toThrow('Tool "report": `ui.runtimeOptions.markdown` applies to a Markdown template');
    const missingTheme = registry.checkRenderOptions('report', {
      template: '# x',
      runtimeOptions: { markdown: { highlightTheme: 'no-such-theme' } },
    });
    await expect(missingTheme).rejects.toBeInstanceOf(ToolUiConfigurationError);
    await expect(missingTheme).rejects.toThrow('"no-such-theme", which is not a highlight.js theme');
  });

  it('accepts a tool without rendering options', async () => {
    await expect(
      new ToolUIRegistry().checkRenderOptions('weather', { template: { file: './weather.widget.tsx' } }),
    ).resolves.toBeUndefined();
  });
});

@Tool({ name: 'sanitized_file_widget', inputSchema: {}, ui: { template: { file: './w.tsx' }, contentSecurity: {} } })
class SanitizedFileWidgetTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'widgets', name: 'Widgets', tools: [SanitizedFileWidgetTool] })
class WidgetsApp {}

describe('a server with a rendering option its template cannot take', () => {
  it('refuses to start, naming the tool and the option', async () => {
    await expect(
      FrontMcpInstance.createDirect({
        info: { name: 'ui-render-options', version: '1.0.0' },
        apps: [WidgetsApp],
        logging: { level: LogLevel.Off, enableConsole: false },
      }),
    ).rejects.toThrow('Tool "sanitized_file_widget": `ui.contentSecurity`');
  });
});
