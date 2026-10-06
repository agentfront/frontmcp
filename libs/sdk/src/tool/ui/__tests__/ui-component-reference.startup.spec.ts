/**
 * A tool whose `ui.template` is a React component reference cannot be bundled. The server warns
 * about it at startup, in the default inline serving mode too (whose lean shell never renders the
 * template), and does not run a template to find out (#769).
 */
import 'reflect-metadata';

import { App, LogLevel, LogTransport, LogTransportInterface, Tool, ToolContext, type LogRecord } from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const lines: string[] = [];

@LogTransport({ name: 'ComponentReferenceCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    lines.push(record.message);
  }
}

class WeatherWidget {
  render(): null {
    return null;
  }
}

let orderCardCalls = 0;
function OrderCard(ctx: { output: { order: { id: string } } }): string {
  orderCardCalls++;
  return `<b>${ctx.output.order.id}</b>`;
}

@Tool({ name: 'weather_widget', inputSchema: {}, ui: { template: WeatherWidget } })
class WeatherTool extends ToolContext {
  async execute() {
    return { temp: 21 };
  }
}

@Tool({ name: 'order_card', inputSchema: {}, ui: { template: OrderCard } })
class OrderTool extends ToolContext {
  async execute() {
    return { order: { id: 'A-1' } };
  }
}

@App({ id: 'widgets', name: 'Widgets', tools: [WeatherTool, OrderTool] })
class WidgetsApp {}

describe('the React component reference warning at startup (#769)', () => {
  it('names an inline-mode tool with a component template before any call, and not a capitalized HTML builder', async () => {
    lines.length = 0;
    orderCardCalls = 0;

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'component-reference', version: '1.0.0' },
      apps: [WidgetsApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
    await server.dispose();

    const componentWarnings = lines.filter((line) => line.includes('React component reference'));
    expect(componentWarnings).toHaveLength(1);
    expect(componentWarnings[0]).toContain('weather_widget');
    expect(orderCardCalls).toBe(0);
  });
});
