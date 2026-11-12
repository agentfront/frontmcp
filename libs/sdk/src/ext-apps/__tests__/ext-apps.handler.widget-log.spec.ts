/**
 * A widget's log message is written on one log line, whatever it holds.
 */
import { ExtAppsMessageHandler, type ExtAppsHandlerContext } from '../ext-apps.handler';
import { type ExtAppsJsonRpcRequest } from '../ext-apps.types';

const logger = {
  debug: jest.fn(),
  verbose: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

function handlerWith(overrides: Partial<ExtAppsHandlerContext> = {}): ExtAppsMessageHandler {
  const context: ExtAppsHandlerContext = {
    sessionId: 'session-1',
    logger: logger as unknown as ExtAppsHandlerContext['logger'],
    callTool: jest.fn(),
    ...overrides,
  };
  return new ExtAppsMessageHandler({ context, hostCapabilities: { serverToolProxy: true, logging: true } });
}

function request(method: string, params: unknown): ExtAppsJsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method, params };
}

beforeEach(() => jest.clearAllMocks());

describe('a widget log message', () => {
  it('stays on one log line', async () => {
    const handler = handlerWith();

    await handler.handleRequest(request('ui/log', { level: 'info', message: 'ok\n[ERROR] forged line' }));
    await handler.handleNotification({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'warning', data: 'ok\r\n[ERROR] another' },
    });

    expect(logger.info).toHaveBeenCalledWith('ok\\n[ERROR] forged line', undefined);
    expect(logger.warn).toHaveBeenCalledWith('ok\\r\\n[ERROR] another', undefined);
  });

  it('keeps the method a widget names on one log line when its request or notification fails', async () => {
    const handler = handlerWith();

    await handler.handleRequest(request('ui/nope\n[ERROR] forged', {}));
    await handler.handleNotification({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'not\nreal', data: 'x' },
    });

    const warnings = logger.warn.mock.calls.map(([line]) => String(line));
    expect(warnings).toHaveLength(2);
    for (const line of warnings) expect(line).not.toMatch(/[\r\n]/);
    expect(warnings[0]).toContain('method=ui/nope\\n[ERROR] forged failed');
  });
});
