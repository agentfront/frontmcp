/**
 * A tools/call naming an unknown tool is logged on one line, whatever the name holds.
 */
import 'reflect-metadata';

import {
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type LogRecord,
} from '../../../common';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const messages: string[] = [];

@LogTransport({ name: 'UnknownToolLogCapture', description: 'Captures log lines for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    messages.push(record.message);
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

describe('the log line of a call to an unknown tool', () => {
  it('keeps a line break in the tool name from starting a new log line', async () => {
    const direct = await FrontMcpInstance.createDirect({
      info: { name: 'unknown-tool-log', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
    try {
      await direct.callTool('nope\r\n[ERROR] forged line', {}).catch(() => undefined);
    } finally {
      await direct.dispose();
    }

    const notFound = messages.filter((message) => message.startsWith('findTool:'));
    expect(notFound).toEqual(['findTool: tool "nope\\r\\n[ERROR] forged line" not found']);
  });
});
