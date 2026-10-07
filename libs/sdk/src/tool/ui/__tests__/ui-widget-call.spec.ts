/**
 * A widget's own `tools/call`, which the bridge marks with `_meta['frontmcp/widgetCall']`, gets the
 * tool's data without the tool's page: the widget that made the call is already on screen. Up to
 * 1.9.2 every such call brought a whole new page (about 36 KB) back into the widget.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { WIDGET_CALL_META_KEY } from '@frontmcp/uipack/bridge-runtime';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type TemplateContext } from '../../../common';

type TicketInput = { id: string };
type Ticket = { id: string; status: string };

@Tool({
  name: 'get_ticket',
  inputSchema: { id: z.string() },
  ui: { template: (ctx: TemplateContext<TicketInput, Ticket>) => ctx.helpers.html`<h2>${ctx.output.id}</h2>` },
})
class GetTicketTool extends ToolContext {
  async execute(input: TicketInput): Promise<Ticket> {
    return { id: input.id, status: 'open' };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool] })
class DeskApp {}

describe('a widget calling a tool that has a widget', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'widget-call', version: '1.0.0' }, apps: [DeskApp] });
  });

  it('gets the data without the page when the bridge marks the call', async () => {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'get_ticket', arguments: { id: 'T-1' } },
      { meta: { [WIDGET_CALL_META_KEY]: true } },
    );

    expect(message.result?.['structuredContent']).toEqual({ id: 'T-1', status: 'open' });
    expect(message.result?.['_meta']).not.toHaveProperty('ui/html');
  });

  it('still renders the page for the model and the host', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'get_ticket',
      arguments: { id: 'T-1' },
    });

    expect(message.result?.['_meta']).toHaveProperty('ui/html');
  });
});
