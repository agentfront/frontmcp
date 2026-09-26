/**
 * `escapeStringResults` for tool UI templates (#601): the tool-level `ui.escapeStringResults`
 * and the server-wide `@FrontMcp({ ui: { escapeStringResults } })` default reach the renderer.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type TemplateContext } from '../../../common';
import { ToolUIRegistry } from '../ui-shared';

const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED_PAYLOAD = '&lt;img src=x onerror=alert(1)&gt;';

type NoteOutput = { note: string };

function renderedHtml(meta: Record<string, unknown>): string {
  return String(meta['ui/html'] ?? '');
}

describe('ToolUIRegistry — escapeStringResults', () => {
  const echoTemplate = (ctx: TemplateContext<unknown, NoteOutput>) => ctx.output.note;

  async function render(registry: ToolUIRegistry, toolName: string, uiConfig: Record<string, unknown>) {
    const { meta } = await registry.renderAndRegisterAsync({
      toolName,
      output: { note: PAYLOAD },
      uiConfig: { template: echoTemplate, ...uiConfig },
    });
    return renderedHtml(meta);
  }

  it('escapes a plain string result when the tool opts in', async () => {
    const html = await render(new ToolUIRegistry(undefined, { logger: { warn: jest.fn() } }), 'tool_opt_in', {
      escapeStringResults: true,
    });

    expect(html).toContain(ESCAPED_PAYLOAD);
    expect(html).not.toContain(PAYLOAD);
  });

  it('applies the registry-wide default when the tool leaves it unset', async () => {
    const html = await render(new ToolUIRegistry(undefined, { escapeStringResults: true }), 'tool_server_default', {});

    expect(html).toContain(ESCAPED_PAYLOAD);
  });

  it('lets the tool setting override the registry-wide default', async () => {
    const warn = jest.fn();
    const html = await render(
      new ToolUIRegistry(undefined, { escapeStringResults: true, logger: { warn } }),
      'tool_override',
      {
        escapeStringResults: false,
      },
    );

    expect(html).toContain(PAYLOAD);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps rendering the string as markup and logs the notice once through the registry logger when unset', async () => {
    const warn = jest.fn();
    const registry = new ToolUIRegistry(undefined, { logger: { warn } });

    const first = await render(registry, 'tool_unset', {});
    await render(registry, 'tool_unset', {});

    expect(first).toContain(PAYLOAD);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('tool_unset');
  });

  it('applies the setting to widgets compiled at startup', async () => {
    const registry = new ToolUIRegistry();

    await registry.compileStaticWidgetAsync({
      toolName: 'tool_static',
      template: () => PAYLOAD,
      uiConfig: { escapeStringResults: true },
    });

    expect(registry.getStaticWidget('tool_static')).toContain(ESCAPED_PAYLOAD);
  });
});

@Tool({
  name: 'echo_note',
  inputSchema: { note: z.string() },
  ui: { template: (ctx: TemplateContext<{ note: string }, NoteOutput>) => ctx.output.note },
})
class EchoNoteTool extends ToolContext {
  async execute(input: { note: string }): Promise<NoteOutput> {
    return { note: input.note };
  }
}

@Tool({
  name: 'bold_note',
  inputSchema: { note: z.string() },
  ui: {
    template: (ctx: TemplateContext<{ note: string }, NoteOutput>) =>
      ctx.helpers.html`<b id="bold-note">${ctx.output.note}</b>`,
  },
})
class BoldNoteTool extends ToolContext {
  async execute(input: { note: string }): Promise<NoteOutput> {
    return { note: input.note };
  }
}

@App({ id: 'notes', name: 'Notes', tools: [EchoNoteTool, BoldNoteTool] })
class NotesApp {}

describe('@FrontMcp({ ui: { escapeStringResults: true } })', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'string-results', version: '1.0.0' },
      apps: [NotesApp],
      ui: { escapeStringResults: true },
    });
  });

  async function callHtml(name: string): Promise<string> {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: { note: PAYLOAD } });
    return renderedHtml((message.result?.['_meta'] ?? {}) as Record<string, unknown>);
  }

  it('escapes a plain string template result', async () => {
    const html = await callHtml('echo_note');

    expect(html).toContain(ESCAPED_PAYLOAD);
    expect(html).not.toContain(PAYLOAD);
  });

  it('keeps html`` markup and escapes the interpolated output', async () => {
    const html = await callHtml('bold_note');

    expect(html).toContain(`<b id="bold-note">${ESCAPED_PAYLOAD}</b>`);
    expect(html).not.toContain(PAYLOAD);
  });
});
