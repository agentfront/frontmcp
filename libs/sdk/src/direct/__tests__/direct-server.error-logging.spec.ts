import 'reflect-metadata';

import { inspect } from 'node:util';

import { App, LogLevel, LogTransport, LogTransportInterface, Tool, ToolContext, type LogRecord } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type DirectMcpServer } from '../direct.types';

const THROWN_MESSAGE = 'inventory service timed out for sku 42';

const capturedLogLines: string[] = [];

@LogTransport({ name: 'DirectErrorCaptureLogger', description: 'Captures every log record for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    const formatArgument = (value: unknown) => (typeof value === 'string' ? value : inspect(value, { depth: 6 }));
    capturedLogLines.push([record.message, ...record.args].map(formatArgument).join(' '));
  }
}

@Tool({ name: 'check_stock', inputSchema: {} })
class CheckStockTool extends ToolContext {
  async execute(): Promise<{ inStock: boolean }> {
    throw new Error(THROWN_MESSAGE);
  }
}

@App({ id: 'shop', name: 'Shop', tools: [CheckStockTool] })
class ShopApp {}

describe('DirectMcpServer failure logging', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'direct-error-logging', version: '1.0.0' },
      apps: [ShopApp],
      logging: { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('logs a failure of a direct tool call once', async () => {
    capturedLogLines.length = 0;

    await expect(server.callTool('check_stock', {})).rejects.toThrow();

    expect(capturedLogLines.filter((line) => line.includes(THROWN_MESSAGE))).toHaveLength(1);
  });
});
