/**
 * `transport.sessionMode` is accepted but nothing reads it (sessions follow `transport.protocol`).
 * `sessionMode: 'stateless'` used to be ignored silently; it now warns at startup (#678).
 */
import 'reflect-metadata';

import {
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { warnIfSessionModeIgnored } from '../session-mode.check';

describe('warnIfSessionModeIgnored', () => {
  it('stays quiet without sessionMode or with the default', () => {
    const warn = jest.fn();
    warnIfSessionModeIgnored({ logger: { warn } });
    warnIfSessionModeIgnored({ logger: { warn }, transport: {} });
    warnIfSessionModeIgnored({ logger: { warn }, transport: { sessionMode: 'stateful' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for 'stateless' and points to the stateless-api protocol", () => {
    const warn = jest.fn();
    warnIfSessionModeIgnored({ logger: { warn }, transport: { sessionMode: 'stateless', protocol: 'legacy' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/transport\.sessionMode \('stateless'\) is ignored/);
    expect(warn.mock.calls[0][0]).toContain("set `transport.protocol: 'stateless-api'`");
  });

  it('says to remove it when the protocol already serves without sessions', () => {
    const warn = jest.fn();
    warnIfSessionModeIgnored({ logger: { warn }, transport: { sessionMode: 'stateless', protocol: 'stateless-api' } });
    expect(warn.mock.calls[0][0]).toContain('already serves without sessions');
  });

  it('warns for a function, once per transport config', () => {
    const warn = jest.fn();
    const transport = { sessionMode: () => 'stateless' };
    warnIfSessionModeIgnored({ logger: { warn }, transport });
    warnIfSessionModeIgnored({ logger: { warn }, transport });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('(a function)');
  });
});

const lines: string[] = [];

@LogTransport({ name: 'SessionModeCapture', description: 'Captures log lines' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    lines.push(record.message);
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'ping', name: 'Ping', tools: [PingTool] })
class PingApp {}

describe('a server configured with transport.sessionMode', () => {
  async function start(transport: FrontMcpConfigInput['transport']): Promise<string[]> {
    lines.length = 0;
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'session-mode', version: '1.0.0' },
      apps: [PingApp],
      transport,
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
    await server.dispose();
    return lines.filter((line) => line.includes('transport.sessionMode'));
  }

  it("warns at startup for sessionMode: 'stateless'", async () => {
    await expect(start({ sessionMode: 'stateless' })).resolves.toHaveLength(1);
  });

  it('starts quietly without it', async () => {
    await expect(start({})).resolves.toEqual([]);
  });
});
