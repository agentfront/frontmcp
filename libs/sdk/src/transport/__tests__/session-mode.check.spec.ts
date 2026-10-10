/**
 * `transport.sessionMode` is accepted but nothing reads it (sessions follow `transport.protocol`).
 * `sessionMode: 'stateless'` used to be ignored silently; it now warns at startup (#678).
 *
 * #702 — kept through 1.x and removed in the next major: the warning says so and names the
 * replacement. The pre-1.0 `@FrontMcp({ session })` option was dropped without a word by the config
 * schema; it is now accepted, ignored, and warned about the same way.
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
    expect(warn.mock.calls[0][0]).toContain('will be removed in the next major');
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

  describe('the pre-1.0 session option', () => {
    it("stays quiet for session.sessionMode: 'stateful', which matches what the server does", () => {
      const warn = jest.fn();
      warnIfSessionModeIgnored({ logger: { warn }, session: {} });
      warnIfSessionModeIgnored({ logger: { warn }, session: { sessionMode: 'stateful' } });
      expect(warn).not.toHaveBeenCalled();
    });

    it("warns for session.sessionMode: 'stateless': tokens never go in the JWT", () => {
      const warn = jest.fn();
      warnIfSessionModeIgnored({ logger: { warn }, session: { sessionMode: 'stateless' } });
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(message).toMatch(/session\.sessionMode \('stateless'\) is ignored and will be removed in the next major/);
      expect(message).toContain('never in the JWT');
      expect(message).toContain("set `transport.protocol: 'stateless-api'` and remove `session`");
    });

    it('points session.platformDetection to transport.platformDetection, once per config', () => {
      const warn = jest.fn();
      const session = { sessionMode: () => 'stateless', platformDetection: { customOnly: true } };
      warnIfSessionModeIgnored({ logger: { warn }, session, transport: { protocol: 'stateless-api' } });
      warnIfSessionModeIgnored({ logger: { warn }, session });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain('(a function)');
      expect(warn.mock.calls[0][0]).toContain('already serves without sessions');
      expect(warn.mock.calls[1][0]).toContain('move it to `transport.platformDetection`');
    });
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
  async function start(config: Pick<FrontMcpConfigInput, 'transport' | 'session'>): Promise<string[]> {
    lines.length = 0;
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'session-mode', version: '1.0.0' },
      apps: [PingApp],
      ...config,
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [CaptureLogTransport] },
    });
    await server.dispose();
    return lines.filter((line) => line.includes('sessionMode') || line.includes('session.'));
  }

  it("warns at startup for sessionMode: 'stateless'", async () => {
    await expect(start({ transport: { sessionMode: 'stateless' } })).resolves.toHaveLength(1);
  });

  it('starts quietly without it', async () => {
    await expect(start({ transport: {} })).resolves.toEqual([]);
  });

  // #702 — the config schema used to drop `session` without a word
  it("warns at startup for the pre-1.0 session: { sessionMode: 'stateless' }", async () => {
    const warnings = await start({ session: { sessionMode: 'stateless' } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('session.sessionMode');
  });
});
