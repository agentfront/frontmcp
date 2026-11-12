import { ErrorHandler } from '../error-handler';
import { PublicMcpError } from '../mcp.error';

function createLogger() {
  return { error: jest.fn(), warn: jest.fn() };
}

describe('ErrorHandler.handle', () => {
  it('logs the error id it answers a plain error with', () => {
    const logger = createLogger();

    const response = new ErrorHandler({ logger, isDevelopment: false }).handle(new Error('db timeout'), {
      toolName: 'lookup',
    });

    const [message, meta] = logger.error.mock.calls[0];
    expect(message).toContain('db timeout');
    expect(meta).toMatchObject({ toolName: 'lookup', errorId: response._meta?.errorId });
    expect(response.content[0].text).toContain(response._meta?.errorId);
  });

  it('logs a public error as a warning and answers with its message', () => {
    const logger = createLogger();

    const response = new ErrorHandler({ logger, isDevelopment: false }).handle(
      new PublicMcpError('Ticket T-1 is already closed', 'TICKET_CLOSED', 409),
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(response.content[0].text).toBe('Ticket T-1 is already closed');
  });

  it('logs an error message that holds a line break on one line', () => {
    const logger = createLogger();
    const handler = new ErrorHandler({ logger, isDevelopment: false });

    handler.handle(new PublicMcpError('remote said no\n[12:00:00.000] ERROR forged', 'REMOTE', 502));
    handler.handle(new Error('lookup failed\r\nINFO forged'));
    handler.logError(new Error('plain\nINFO forged'));

    expect(logger.warn.mock.calls[0][0]).toBe('Public error: remote said no\\n[12:00:00.000] ERROR forged');
    expect(logger.error.mock.calls[0][0]).toContain('lookup failed\\r\\nINFO forged');
    expect(logger.error.mock.calls[1][0]).toBe('Unexpected error: plain\\nINFO forged');
  });
});
