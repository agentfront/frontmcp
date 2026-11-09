/**
 * A tool's log messages and progress go on the response stream of the request that called it, so the
 * client has them before the call's result; once that stream is gone they go to the session's stream.
 */
import { NotificationService } from '../notification.service';

function createMockScope() {
  const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    logger: { ...logger, child: jest.fn().mockReturnValue(logger) },
    providers: { cleanupSession: jest.fn() },
    resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
  };
}

describe('NotificationService notifications that belong to a request', () => {
  let service: NotificationService;
  let notification: jest.Mock;

  beforeEach(() => {
    service = new NotificationService(createMockScope() as never);
    notification = jest.fn().mockResolvedValue(undefined);
    service.registerServer('session-1', { notification, request: jest.fn() } as never);
  });

  it("sends progress on the request's response stream", async () => {
    service.sendProgressNotification('session-1', 'token-1', 1, 2, 'first step', 7);
    await new Promise(process.nextTick);

    expect(notification).toHaveBeenCalledWith(
      {
        method: 'notifications/progress',
        params: { progressToken: 'token-1', progress: 1, total: 2, message: 'first step' },
      },
      { relatedRequestId: 7 },
    );
  });

  it("sends log messages on the request's response stream", async () => {
    service.setLogLevel('session-1', 'debug');

    service.sendLogMessageToSession('session-1', 'info', 'import', { message: 'saving' }, 'call-3');
    await new Promise(process.nextTick);

    expect(notification).toHaveBeenCalledWith(
      { method: 'notifications/message', params: { level: 'info', logger: 'import', data: { message: 'saving' } } },
      { relatedRequestId: 'call-3' },
    );
  });

  it("falls back to the session's stream once the request's stream is gone, keeping the session", async () => {
    notification.mockRejectedValueOnce(new Error('No connection established for request ID: 7'));

    service.sendProgressNotification('session-1', 'token-1', 1, undefined, undefined, 7);
    await new Promise(process.nextTick);

    expect(notification).toHaveBeenLastCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 1 },
    });
    expect(service.getRegisteredServer('session-1')).toBeDefined();
  });

  it('sends a notification without a request on the session stream, as before', () => {
    service.sendProgressNotification('session-1', 'token-1', 1);

    expect(notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 1 },
    });
  });
});
