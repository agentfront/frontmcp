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
});
