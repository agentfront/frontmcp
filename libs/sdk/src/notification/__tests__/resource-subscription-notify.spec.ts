/**
 * @file resource-subscription-notify.spec.ts
 * @description Tests for resource subscription notification dispatch.
 *
 * Verifies that:
 * - notifyResourceUpdated sends notifications only to subscribed sessions
 * - notifyResourceUpdated is a no-op when no subscribers exist
 * - NotificationService.initialize() dispatches 'updated' events vs 'list_changed'
 * - ResourceRegistry.notifyContentChanged() emits proper events
 */

import { NotificationService } from '../notification.service';
import { ResourceEmitter } from '../../resource/resource.events';

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
    resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
  };
}

describe('NotificationService - resource subscription notifications', () => {
  let service: NotificationService;
  let mockScope: ReturnType<typeof createMockScope>;

  beforeEach(() => {
    mockScope = createMockScope();
    service = new NotificationService(mockScope as never);
  });

  describe('notifyResourceUpdated', () => {
    it('should send notification only to sessions subscribed to the URI', () => {
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
