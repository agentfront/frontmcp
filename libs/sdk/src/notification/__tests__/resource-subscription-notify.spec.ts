/**
 * @file resource-subscription-notify.spec.ts
 * @description Tests for resource subscription notification dispatch.
 *
 * Verifies that:
 * - notifyResourceUpdated sends notifications only to subscribed sessions
 * - each update is sent only while resources:subscribe still admits the session's caller
 * - notifyResourceUpdated is a no-op when no subscribers exist
 * - NotificationService.initialize() dispatches 'updated' events vs 'list_changed'
 * - ResourceRegistry.notifyContentChanged() emits proper events
 */

import { ResourceEmitter } from '../../resource/resource.events';
import { NotificationService } from '../notification.service';

const mockRequestTurn = { held: false };

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    runRequestExclusive: jest.fn(async (fn: () => unknown) => {
      mockRequestTurn.held = true;
      try {
        return await fn();
      } finally {
        mockRequestTurn.held = false;
      }
    }),
  };
});

const createMockServer = () =>
  ({
    notification: jest.fn(),
    request: jest.fn(),
  }) as never;

function createMockScope() {
  return {
    logger: {
      verbose: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnValue({
        verbose: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    },
    providers: {
      cleanupSession: jest.fn(),
    },
    metadata: {},
    runFlow: jest.fn().mockResolvedValue({}),
    resources: { subscribe: jest.fn().mockReturnValue(() => {}), watchUri: jest.fn(), unwatchUri: jest.fn() },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
  };
}

/** Let the access check each update runs settle. */
const flushChecks = () => new Promise((resolve) => setImmediate(resolve));

describe('NotificationService - resource subscription notifications', () => {
  let service: NotificationService;
  let mockScope: ReturnType<typeof createMockScope>;

  beforeEach(() => {
    mockScope = createMockScope();
    service = new NotificationService(mockScope as never);
  });

  describe('notifyResourceUpdated', () => {
    it('should send notification only to sessions subscribed to the URI', async () => {
      const server1 = createMockServer();
      const server2 = createMockServer();
      const server3 = createMockServer();

      service.registerServer('session-1', server1);
      service.registerServer('session-2', server2);
      service.registerServer('session-3', server3);

      service.subscribeResource('session-1', 'file://notes.txt');
      service.subscribeResource('session-2', 'file://notes.txt');
      // session-3 is NOT subscribed

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect((server1 as any).notification).toHaveBeenCalledWith({
        method: 'notifications/resources/updated',
        params: { uri: 'file://notes.txt' },
      });
      expect((server2 as any).notification).toHaveBeenCalledWith({
        method: 'notifications/resources/updated',
        params: { uri: 'file://notes.txt' },
      });
      expect((server3 as any).notification).not.toHaveBeenCalled();
    });

    it('should be a no-op when no subscribers exist', () => {
      const server = createMockServer();
      service.registerServer('session-1', server);

      service.notifyResourceUpdated('file://no-subscribers.txt');

      expect((server as any).notification).not.toHaveBeenCalled();
    });

    it('should not notify sessions subscribed to a different URI', () => {
      const server = createMockServer();
      service.registerServer('session-1', server);
      service.subscribeResource('session-1', 'file://other.txt');

      service.notifyResourceUpdated('file://notes.txt');

      expect((server as any).notification).not.toHaveBeenCalled();
    });

    it('should not notify after session unsubscribes', () => {
      const server = createMockServer();
      service.registerServer('session-1', server);
      service.subscribeResource('session-1', 'file://notes.txt');
      service.unsubscribeResource('session-1', 'file://notes.txt');

      service.notifyResourceUpdated('file://notes.txt');

      expect((server as any).notification).not.toHaveBeenCalled();
    });
  });

  describe('access checked again for each update', () => {
    function subscribedSession(caller?: Record<string, unknown>) {
      const server = createMockServer();
      service.registerServer('session-1', server);
      if (caller) service.setCaller('session-1', caller);
      service.subscribeResource('session-1', 'file://notes.txt');
      return server as unknown as { notification: jest.Mock };
    }

    it("checks the session's latest caller with resources:subscribe, without subscribing it again", async () => {
      const server = subscribedSession({ clientId: 'client-1', scopes: ['notes:read'] });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(mockScope.runFlow).toHaveBeenCalledWith('resources:subscribe', {
        request: { method: 'resources/subscribe', params: { uri: 'file://notes.txt' } },
        ctx: expect.objectContaining({
          authInfo: expect.objectContaining({ clientId: 'client-1', sessionId: 'session-1' }),
          ownRequest: true,
          checkOnly: true,
        }),
      });
      expect(server.notification).toHaveBeenCalledTimes(1);
    });

    it('runs the check with the platform bindings of the request that subscribed', async () => {
      const server = createMockServer();
      service.registerServer('session-1', server);
      service.subscribeResource('session-1', 'file://notes.txt', { NOTES_ON: true });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(mockScope.runFlow.mock.calls[0][1].ctx.platformEnv).toEqual({ NOTES_ON: true });
    });

    it('runs each check in a request turn of its own', async () => {
      const turnsHeld: boolean[] = [];
      mockScope.runFlow.mockImplementation(async () => {
        turnsHeld.push(mockRequestTurn.held);
        return {};
      });
      subscribedSession({ clientId: 'client-1' });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(turnsHeld).toEqual([true]);
    });

    it('sends nothing once the check refuses the caller', async () => {
      mockScope.runFlow.mockRejectedValueOnce(new Error('denied'));
      const server = subscribedSession({ clientId: 'client-1' });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(server.notification).not.toHaveBeenCalled();
    });

    it('sends nothing when the session unsubscribed while its access was checked', async () => {
      const server = subscribedSession({ clientId: 'client-1' });
      mockScope.runFlow.mockImplementationOnce(async () => {
        service.unsubscribeResource('session-1', 'file://notes.txt');
        return {};
      });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(server.notification).not.toHaveBeenCalled();
    });

    it("checks the session's latest caller when a request replaced it while its access was checked", async () => {
      const server = subscribedSession({ clientId: 'client-1' });
      mockScope.runFlow.mockImplementationOnce(async () => {
        service.setCaller('session-1', { clientId: 'client-2' });
        return {};
      });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(mockScope.runFlow).toHaveBeenCalledTimes(2);
      expect(mockScope.runFlow.mock.calls[1][1].ctx.authInfo).toEqual({ clientId: 'client-2', sessionId: 'session-1' });
      expect(server.notification).toHaveBeenCalledTimes(1);
    });

    it("sends nothing when the session's latest caller is refused", async () => {
      const server = subscribedSession({ clientId: 'client-1' });
      mockScope.runFlow
        .mockImplementationOnce(async () => {
          service.setCaller('session-1', { clientId: 'client-2' });
          return {};
        })
        .mockRejectedValueOnce(new Error('denied'));

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(server.notification).not.toHaveBeenCalled();
    });

    it('sends to a subscriber whose caller a request kept again as an equal copy, checking it once', async () => {
      const server = subscribedSession({ clientId: 'client-1', scopes: ['notes:read'] });
      mockScope.runFlow.mockImplementationOnce(async () => {
        service.setCaller('session-1', { clientId: 'client-1', scopes: ['notes:read'] });
        return {};
      });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(mockScope.runFlow).toHaveBeenCalledTimes(1);
      expect(server.notification).toHaveBeenCalledTimes(1);
    });

    it("sends nothing, and checks nothing, once the caller's credentials expired", async () => {
      const server = subscribedSession({ clientId: 'client-1', expiresAt: Math.floor(Date.now() / 1000) - 60 });

      service.notifyResourceUpdated('file://notes.txt');
      await flushChecks();

      expect(mockScope.runFlow).not.toHaveBeenCalled();
      expect(server.notification).not.toHaveBeenCalled();
    });
  });

  describe('subscribers counted on the registry', () => {
    it('counts a URI once per session, until it unsubscribes or its session ends', () => {
      service.registerServer('session-1', createMockServer());
      service.registerServer('session-2', createMockServer());

      service.subscribeResource('session-1', 'file://notes.txt');
      service.subscribeResource('session-1', 'file://notes.txt');
      service.subscribeResource('session-2', 'file://notes.txt');
      service.subscribeResource('session-2', 'file://todo.txt');
      expect(mockScope.resources.watchUri.mock.calls).toEqual([
        ['file://notes.txt'],
        ['file://notes.txt'],
        ['file://todo.txt'],
      ]);

      service.unsubscribeResource('session-1', 'file://notes.txt');
      service.unsubscribeResource('session-1', 'file://notes.txt');
      service.unregisterServer('session-2');
      expect(mockScope.resources.unwatchUri.mock.calls).toEqual([
        ['file://notes.txt'],
        ['file://notes.txt'],
        ['file://todo.txt'],
      ]);
    });
  });

  describe('initialize() - event dispatching', () => {
    it('should dispatch notifyResourceUpdated for updated events with updatedUri', async () => {
      let resourceCallback: (event: any) => void = () => {};
      mockScope.resources.subscribe.mockImplementation((_opts: any, cb: any) => {
        resourceCallback = cb;
        return () => {};
      });

      await service.initialize();

      const server = createMockServer();
      service.registerServer('session-1', server);
      service.subscribeResource('session-1', 'file://data.json');

      resourceCallback({
        kind: 'updated',
        changeScope: 'global',
        version: 1,
        snapshot: [],
        updatedUri: 'file://data.json',
      });
      await flushChecks();

      expect((server as any).notification).toHaveBeenCalledWith({
        method: 'notifications/resources/updated',
        params: { uri: 'file://data.json' },
      });
    });

    it('should broadcast list_changed for non-updated events', async () => {
      let resourceCallback: (event: any) => void = () => {};
      mockScope.resources.subscribe.mockImplementation((_opts: any, cb: any) => {
        resourceCallback = cb;
        return () => {};
      });

      await service.initialize();

      const server = createMockServer();
      service.registerServer('session-1', server);

      resourceCallback({
        kind: 'added',
        changeScope: 'global',
        version: 2,
        snapshot: [],
      });

      expect((server as any).notification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'notifications/resources/list_changed',
        }),
      );
    });

    it('should broadcast list_changed for updated event without updatedUri', async () => {
      let resourceCallback: (event: any) => void = () => {};
      mockScope.resources.subscribe.mockImplementation((_opts: any, cb: any) => {
        resourceCallback = cb;
        return () => {};
      });

      await service.initialize();

      const server = createMockServer();
      service.registerServer('session-1', server);

      resourceCallback({
        kind: 'updated',
        changeScope: 'global',
        version: 3,
        snapshot: [],
        // no updatedUri
      });

      expect((server as any).notification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'notifications/resources/list_changed',
        }),
      );
    });

    it('should not dispatch for session-scoped events', async () => {
      let resourceCallback: (event: any) => void = () => {};
      mockScope.resources.subscribe.mockImplementation((_opts: any, cb: any) => {
        resourceCallback = cb;
        return () => {};
      });

      await service.initialize();

      const server = createMockServer();
      service.registerServer('session-1', server);

      resourceCallback({
        kind: 'updated',
        changeScope: 'session',
        version: 1,
        snapshot: [],
        updatedUri: 'file://data.json',
      });

      expect((server as any).notification).not.toHaveBeenCalled();
    });
  });
});

describe('ResourceEmitter - updatedUri propagation', () => {
  it('should propagate updatedUri through emit', () => {
    const emitter = new ResourceEmitter();
    const received: any[] = [];

    emitter.on((e) => received.push(e));

    emitter.emit({
      kind: 'updated',
      changeScope: 'global',
      version: 1,
      snapshot: [],
      updatedUri: 'file://test.txt',
    });

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('updated');
    expect(received[0].updatedUri).toBe('file://test.txt');
  });

  it('should leave updatedUri undefined for non-content events', () => {
    const emitter = new ResourceEmitter();
    const received: any[] = [];

    emitter.on((e) => received.push(e));

    emitter.emit({
      kind: 'added',
      changeScope: 'global',
      version: 1,
      snapshot: [],
    });

    expect(received).toHaveLength(1);
    expect(received[0].updatedUri).toBeUndefined();
  });
});
