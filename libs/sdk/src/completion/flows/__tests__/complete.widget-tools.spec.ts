/** `ui://widget/{toolName}` completion offers only the UI tools `tools/list` shows the caller (#596). */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, FlowHooksOf, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../../common';

const ListToolsHook = FlowHooksOf('tools:list-tools');

const WIDGET = { template: '<div id="widget"></div>' };

@Plugin({ name: 'withheld-tools' })
class WithheldToolsPlugin {
  @ListToolsHook.Did('findTools')
  withhold(ctx: FlowCtxOf<'tools:list-tools'>) {
    const kept = ctx.state.tools?.filter(({ tool }) => tool.metadata.name !== 'withheld_widget');
    if (kept) ctx.state.set('tools', kept);
  }
}

@Tool({ name: 'orders_widget', inputSchema: {}, ui: WIDGET })
class OrdersWidgetTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({ name: 'withheld_widget', inputSchema: {}, ui: WIDGET })
class WithheldWidgetTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({ name: 'hidden_widget', inputSchema: {}, ui: WIDGET, visibility: 'hidden' })
class HiddenWidgetTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({ name: 'internal_widget', inputSchema: {}, ui: WIDGET, visibility: 'internal' })
class InternalWidgetTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({ name: 'orders_report', inputSchema: {} })
class OrdersReportTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({
  id: 'orders',
  name: 'Orders',
  plugins: [WithheldToolsPlugin],
  tools: [OrdersWidgetTool, WithheldWidgetTool, HiddenWidgetTool, InternalWidgetTool, OrdersReportTool],
})
class OrdersApp {}

describe('completion of ui://widget/{toolName} (#596)', () => {
  let server: TestFetchServer;

  async function completeToolName(value: string): Promise<unknown> {
    const { message } = await rpc20260728(server.handler, 'completion/complete', {
      ref: { type: 'ref/resource', uri: 'ui://widget/{toolName}.html' },
      argument: { name: 'toolName', value },
    });
    expect(message.error).toBeUndefined();
    return message.result?.['completion'];
  }

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'widget-completion', version: '1.0.0' }, apps: [OrdersApp] });
  });

  it('offers only the widget tools tools/list shows the caller', async () => {
    await expect(completeToolName('')).resolves.toEqual({ values: ['orders_widget'], total: 1 });
  });

  it('leaves out a widget tool a tools/list filter withholds', async () => {
    const completion = await completeToolName('withheld');

    expect(completion).toEqual({ values: [], total: 0 });
  });

  it('leaves out hidden and internal widget tools', async () => {
    await expect(completeToolName('hidden')).resolves.toEqual({ values: [], total: 0 });
    await expect(completeToolName('internal')).resolves.toEqual({ values: [], total: 0 });
  });

  it('filters the offered names by the typed prefix', async () => {
    await expect(completeToolName('ORD')).resolves.toEqual({ values: ['orders_widget'], total: 1 });
    await expect(completeToolName('zzz')).resolves.toEqual({ values: [], total: 0 });
  });
});
