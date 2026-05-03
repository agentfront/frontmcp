/**
 * Tests for `notifications/skills/list_changed` broadcast on skill registry change.
 *
 * Verifies that NotificationService subscribes to scope.skills during
 * initialize() and broadcasts the spec-aligned (SEP-2076 anticipated)
 * notification to all registered MCP servers when the registry emits a global
 * change event. Also verifies the subscription is fault-tolerant when the
 * scope happens to lack a skills registry (e.g. minimal embed scenarios).
 */

import { NotificationService } from '../notification.service';

type EventHandler = (event: { changeScope: 'global' | 'local'; kind: string }) => void;

const createMockServer = () =>
  ({
    notification: jest.fn(),
    request: jest.fn(),
  }) as never;

function createScopeWithSkills() {
  let skillsHandler: EventHandler | undefined;
  const skillsUnsub = jest.fn();
  return {
    skillsHandler: () => skillsHandler!,
    skillsUnsub,
    scope: {
      logger: {
        verbose: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnValue({
          verbose: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        }),
      },
      providers: { cleanupSession: jest.fn() },
      resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
      tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
      prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
      skills: {
        subscribe: jest.fn((_opts: unknown, cb: EventHandler) => {
          skillsHandler = cb;
          return skillsUnsub;
        }),
      },
    },
  };
}

function createScopeWithoutSkills() {
  return {
    logger: {
      verbose: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnValue({
        verbose: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }),
    },
    providers: { cleanupSession: jest.fn() },
    resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
    // skills intentionally absent
  };
}

describe('NotificationService — notifications/skills/list_changed', () => {
  it('subscribes to scope.skills during initialize and broadcasts on global change', async () => {
    const { scope, skillsHandler } = createScopeWithSkills();
    const service = new NotificationService(scope as never);
    await service.initialize();

    const server1 = createMockServer();
    const server2 = createMockServer();
    service.registerServer('s1', server1);
    service.registerServer('s2', server2);

    skillsHandler()({ changeScope: 'global', kind: 'reset' });

    expect((server1 as never as { notification: jest.Mock }).notification).toHaveBeenCalledWith({
      method: 'notifications/skills/list_changed',
      params: {},
    });
    expect((server2 as never as { notification: jest.Mock }).notification).toHaveBeenCalledWith({
      method: 'notifications/skills/list_changed',
      params: {},
    });
  });

  it('does not broadcast when changeScope is local', async () => {
    const { scope, skillsHandler } = createScopeWithSkills();
    const service = new NotificationService(scope as never);
    await service.initialize();

    const server = createMockServer();
    service.registerServer('s1', server);

    skillsHandler()({ changeScope: 'local', kind: 'reset' });

    expect((server as never as { notification: jest.Mock }).notification).not.toHaveBeenCalled();
  });

  it('initialize() does not throw when scope.skills is absent', async () => {
    const scope = createScopeWithoutSkills();
    const service = new NotificationService(scope as never);
    await expect(service.initialize()).resolves.toBeUndefined();
  });

  it('destroy() unsubscribes the skills listener', async () => {
    const { scope, skillsUnsub } = createScopeWithSkills();
    const service = new NotificationService(scope as never);
    await service.initialize();
    await service.destroy();
    expect(skillsUnsub).toHaveBeenCalled();
  });
});
