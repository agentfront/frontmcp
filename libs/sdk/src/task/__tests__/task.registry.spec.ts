/**
 * Tests for TaskRegistry — abort tracking + server capability projection.
 */

import { TaskRegistry } from '../task.registry';

describe('TaskRegistry', () => {
  describe('abort tracking', () => {
    it('trackRunning returns a fresh AbortController and abort() fires its signal', () => {
      const reg = new TaskRegistry();
      const controller = reg.trackRunning('t-1');
      const spy = jest.fn();
      controller.signal.addEventListener('abort', spy);
      expect(reg.runningCount()).toBe(1);
      const fired = reg.abort('t-1', 'user-request');
      expect(fired).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('abort returns false when task is not registered on this node', () => {
      const reg = new TaskRegistry();
      expect(reg.abort('unknown-task')).toBe(false);
    });

    it('untrack removes the controller', () => {
      const reg = new TaskRegistry();
      reg.trackRunning('t-2');
      reg.untrack('t-2');
      expect(reg.runningCount()).toBe(0);
      expect(reg.abort('t-2')).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('returns empty when no tool declares taskSupport', () => {
      const reg = new TaskRegistry();
      expect(reg.getCapabilities({ hasTaskEnabledTool: false, canIdentifyRequestors: true })).toEqual({});
    });

    it('advertises tasks.cancel and tasks.requests.tools.call when enabled', () => {
      const reg = new TaskRegistry();
      const caps = reg.getCapabilities({ hasTaskEnabledTool: true, canIdentifyRequestors: true }) as {
        tasks: { cancel: object; list?: object; requests: { tools: { call: object } } };
      };
      expect(caps.tasks.cancel).toEqual({});
      expect(caps.tasks.requests.tools.call).toEqual({});
      expect(caps.tasks.list).toEqual({});
    });

    it('suppresses tasks.list when requestors cannot be identified', () => {
      const reg = new TaskRegistry();
      const caps = reg.getCapabilities({ hasTaskEnabledTool: true, canIdentifyRequestors: false }) as {
        tasks: { cancel: object; list?: object };
      };
      expect(caps.tasks.list).toBeUndefined();
      expect(caps.tasks.cancel).toEqual({});
    });

    it('returns empty when explicitly disabled via config', () => {
      const reg = new TaskRegistry({ enabled: false });
      expect(reg.getCapabilities({ hasTaskEnabledTool: true, canIdentifyRequestors: true })).toEqual({});
    });
  });
});
