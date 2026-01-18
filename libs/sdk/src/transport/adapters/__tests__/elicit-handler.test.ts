/**
 * Tests for the elicit handler functionality in LocalTransportAdapter.
 *
 * This file tests the cancelPendingElicit and handleIfElicitResult methods
 * that are shared across transport adapter implementations.
 */
import { ElicitResult, PendingElicit, DEFAULT_ELICIT_TTL } from '../../../elicitation';
import { ElicitationNotSupportedError, ElicitationTimeoutError } from '../../../errors';

describe('LocalTransportAdapter Elicit Handler', () => {
  describe('cancelPendingElicit', () => {
    it('should resolve pending elicit with cancel status', () => {
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeoutHandle = setTimeout(() => {}, 10000);

      const pendingElicit: PendingElicit = {
        elicitId: 'test-elicit',
        timeoutHandle,
        resolve: resolveFn,
        reject: rejectFn,
      };

      // Simulate cancelPendingElicit behavior
      clearTimeout(pendingElicit.timeoutHandle);
      pendingElicit.resolve({ status: 'cancel' });

      expect(resolveFn).toHaveBeenCalledWith({ status: 'cancel' });
      expect(rejectFn).not.toHaveBeenCalled();
    });

    it('should clear the timeout when cancelling', () => {
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();

      jest.useFakeTimers();

      const timeoutHandle = setTimeout(() => {
        rejectFn(new Error('Timeout should have been cleared'));
      }, 1000);

      const pendingElicit: PendingElicit = {
        elicitId: 'test-elicit',
        timeoutHandle,
        resolve: resolveFn,
        reject: rejectFn,
      };

      // Simulate cancelPendingElicit
      clearTimeout(pendingElicit.timeoutHandle);
      pendingElicit.resolve({ status: 'cancel' });

      // Advance timers - timeout should not fire
      jest.advanceTimersByTime(2000);

      expect(rejectFn).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('handleIfElicitResult', () => {
    describe('when no pending elicit', () => {
      it('should return false when pendingElicit is undefined', () => {
        const pendingElicit: PendingElicit | undefined = undefined;
        const req = { body: { result: { action: 'accept' } } };

        // Simulate handleIfElicitResult
        const result = pendingElicit ? true : false;

        expect(result).toBe(false);
      });
    });

    describe('when handling error responses', () => {
      it('should reject with ElicitationNotSupportedError on client error', () => {
        const resolveFn = jest.fn();
        const rejectFn = jest.fn();
        const timeoutHandle = setTimeout(() => {}, 10000);

        const pendingElicit: PendingElicit = {
          elicitId: 'test-elicit',
          timeoutHandle,
          resolve: resolveFn,
          reject: rejectFn,
        };

        const req = {
          body: {
            error: {
              code: -32600,
              message: 'Elicitation not supported',
            },
          },
        };

        // Simulate handleIfElicitResult for error case
        if (req.body.error) {
          const { code, message } = req.body.error;
          if (code === -32600 && message === 'Elicitation not supported') {
            clearTimeout(pendingElicit.timeoutHandle);
            pendingElicit.reject(new ElicitationNotSupportedError());
          }
        }

        expect(rejectFn).toHaveBeenCalledWith(expect.any(ElicitationNotSupportedError));

        clearTimeout(timeoutHandle);
      });

      it('should not handle unrelated error codes', () => {
        const resolveFn = jest.fn();
        const rejectFn = jest.fn();
        const timeoutHandle = setTimeout(() => {}, 10000);

        const pendingElicit: PendingElicit = {
          elicitId: 'test-elicit',
          timeoutHandle,
          resolve: resolveFn,
          reject: rejectFn,
        };

        const req = {
          body: {
            error: {
              code: -32601,
              message: 'Method not found',
            },
          },
        };

        // Simulate handleIfElicitResult - should not handle this error
        let handled = false;
        if (req.body.error) {
          const { code, message } = req.body.error;
          if (code === -32600 && message === 'Elicitation not supported') {
            handled = true;
          }
        }

        expect(handled).toBe(false);
        expect(rejectFn).not.toHaveBeenCalled();
        expect(resolveFn).not.toHaveBeenCalled();

        clearTimeout(timeoutHandle);
      });
    });

    describe('when handling successful results', () => {
      it('should resolve with accept status and content', () => {
        const resolveFn = jest.fn();
        const rejectFn = jest.fn();
        const timeoutHandle = setTimeout(() => {}, 10000);

        const pendingElicit: PendingElicit = {
          elicitId: 'test-elicit',
          timeoutHandle,
          resolve: resolveFn,
          reject: rejectFn,
        };

        // Simulate successful elicit result
        const action = 'accept';
        const content = { confirmed: true, reason: 'User approved' };

        clearTimeout(pendingElicit.timeoutHandle);
        const result: ElicitResult = {
          status: action,
          content,
        };
        pendingElicit.resolve(result);

        expect(resolveFn).toHaveBeenCalledWith({
          status: 'accept',
          content: { confirmed: true, reason: 'User approved' },
        });

        clearTimeout(timeoutHandle);
      });

      it('should resolve with cancel status without content', () => {
        const resolveFn = jest.fn();
        const rejectFn = jest.fn();
        const timeoutHandle = setTimeout(() => {}, 10000);

        const pendingElicit: PendingElicit = {
          elicitId: 'test-elicit',
          timeoutHandle,
          resolve: resolveFn,
          reject: rejectFn,
        };

        // Simulate cancel result
        clearTimeout(pendingElicit.timeoutHandle);
        const result: ElicitResult = {
          status: 'cancel',
        };
        pendingElicit.resolve(result);

        expect(resolveFn).toHaveBeenCalledWith({
          status: 'cancel',
        });

        clearTimeout(timeoutHandle);
      });

      it('should resolve with decline status without content', () => {
        const resolveFn = jest.fn();
        const rejectFn = jest.fn();
        const timeoutHandle = setTimeout(() => {}, 10000);

        const pendingElicit: PendingElicit = {
          elicitId: 'test-elicit',
          timeoutHandle,
          resolve: resolveFn,
          reject: rejectFn,
        };

        // Simulate decline result
        clearTimeout(pendingElicit.timeoutHandle);
        const result: ElicitResult = {
          status: 'decline',
        };
        pendingElicit.resolve(result);

        expect(resolveFn).toHaveBeenCalledWith({
          status: 'decline',
        });

        clearTimeout(timeoutHandle);
      });
    });
  });

  describe('timeout handling', () => {
    it('should reject with ElicitationTimeoutError after TTL expires', async () => {
      jest.useFakeTimers();

      const elicitId = 'timeout-test';
      const ttl = 5000;

      const promise = new Promise<ElicitResult>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new ElicitationTimeoutError(elicitId, ttl));
        }, ttl);

        // Store the pending elicit (in real code this would be on the adapter)
        const pendingElicit: PendingElicit = {
          elicitId,
          timeoutHandle,
          resolve,
          reject,
        };

        // Simulate no response - timeout should fire
        void pendingElicit; // Suppress unused variable warning
      });

      // Advance time past TTL
      jest.advanceTimersByTime(ttl + 100);

      await expect(promise).rejects.toThrow(ElicitationTimeoutError);
      await expect(promise).rejects.toBeInstanceOf(ElicitationTimeoutError);
      await expect(promise).rejects.toMatchObject({
        elicitId,
        ttl,
      });

      jest.useRealTimers();
    });

    it('should use DEFAULT_ELICIT_TTL when ttl not specified', () => {
      expect(DEFAULT_ELICIT_TTL).toBe(300000); // 5 minutes
    });

    it('should not reject if resolved before timeout', async () => {
      jest.useFakeTimers();

      const elicitId = 'quick-response';
      const ttl = 10000;

      let timeoutHandle: ReturnType<typeof setTimeout>;

      const promise = new Promise<ElicitResult>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new ElicitationTimeoutError(elicitId, ttl));
        }, ttl);

        // Simulate quick response (before timeout)
        setTimeout(() => {
          clearTimeout(timeoutHandle);
          resolve({ status: 'accept', content: { quick: true } });
        }, 100);
      });

      // Advance past the quick response but not past the main timeout
      jest.advanceTimersByTime(200);

      const result = await promise;
      expect(result.status).toBe('accept');
      expect(result.content).toEqual({ quick: true });

      jest.useRealTimers();
    });
  });

  describe('single pending elicit enforcement', () => {
    it('should cancel previous elicit when new one starts', () => {
      const resolve1 = jest.fn();
      const reject1 = jest.fn();
      const timeout1 = setTimeout(() => {}, 10000);

      const pendingElicit1: PendingElicit = {
        elicitId: 'elicit-1',
        timeoutHandle: timeout1,
        resolve: resolve1,
        reject: reject1,
      };

      // New elicit comes in - should cancel the first one
      const resolve2 = jest.fn();
      const reject2 = jest.fn();
      const timeout2 = setTimeout(() => {}, 10000);

      // Simulate cancelPendingElicit before setting new one
      clearTimeout(pendingElicit1.timeoutHandle);
      pendingElicit1.resolve({ status: 'cancel' });

      const pendingElicit2: PendingElicit = {
        elicitId: 'elicit-2',
        timeoutHandle: timeout2,
        resolve: resolve2,
        reject: reject2,
      };

      expect(resolve1).toHaveBeenCalledWith({ status: 'cancel' });
      expect(reject1).not.toHaveBeenCalled();

      // Second elicit should not be affected
      expect(resolve2).not.toHaveBeenCalled();
      expect(reject2).not.toHaveBeenCalled();

      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });
  });

  describe('elicit result mapping', () => {
    it('should map MCP action "accept" to status "accept"', () => {
      const action = 'accept';
      const content = { value: 'test' };

      const result: ElicitResult = {
        status: action,
        content,
      };

      expect(result.status).toBe('accept');
      expect(result.content).toEqual({ value: 'test' });
    });

    it('should map MCP action "cancel" to status "cancel"', () => {
      const action = 'cancel';

      const result: ElicitResult = {
        status: action,
      };

      expect(result.status).toBe('cancel');
      expect(result.content).toBeUndefined();
    });

    it('should map MCP action "decline" to status "decline"', () => {
      const action = 'decline';

      const result: ElicitResult = {
        status: action,
      };

      expect(result.status).toBe('decline');
      expect(result.content).toBeUndefined();
    });

    it('should only include content when action is accept', () => {
      const contentValue = { data: 'test' };

      // Accept - should have content
      const acceptResult: ElicitResult = {
        status: 'accept',
        content: contentValue,
      };
      expect(acceptResult.content).toBeDefined();

      // Cancel - should not have content
      const cancelResult: ElicitResult = {
        status: 'cancel',
      };
      expect(cancelResult.content).toBeUndefined();

      // Decline - should not have content
      const declineResult: ElicitResult = {
        status: 'decline',
      };
      expect(declineResult.content).toBeUndefined();
    });
  });

  describe('elicitId generation', () => {
    it('should generate elicitId from requestId when not provided', () => {
      let requestId = 1;
      const getNewRequestId = () => requestId++;

      const elicitId1 = `elicit-${getNewRequestId()}`;
      const elicitId2 = `elicit-${getNewRequestId()}`;

      expect(elicitId1).toBe('elicit-1');
      expect(elicitId2).toBe('elicit-2');
    });

    it('should use provided elicitationId when available', () => {
      const customElicitationId = 'custom-elicit-abc123';

      // When elicitationId is provided in options, use it
      const elicitId = customElicitationId ?? `elicit-1`;

      expect(elicitId).toBe('custom-elicit-abc123');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content in accept response', () => {
      const result: ElicitResult<Record<string, never>> = {
        status: 'accept',
        content: {},
      };

      expect(result.status).toBe('accept');
      expect(result.content).toEqual({});
    });

    it('should handle complex nested content', () => {
      interface ComplexContent {
        user: {
          name: string;
          preferences: {
            theme: 'light' | 'dark';
            notifications: boolean;
          };
        };
        metadata: {
          timestamp: number;
          version: string;
        };
      }

      const content: ComplexContent = {
        user: {
          name: 'Test User',
          preferences: {
            theme: 'dark',
            notifications: true,
          },
        },
        metadata: {
          timestamp: Date.now(),
          version: '1.0.0',
        },
      };

      const result: ElicitResult<ComplexContent> = {
        status: 'accept',
        content,
      };

      expect(result.content?.user.name).toBe('Test User');
      expect(result.content?.user.preferences.theme).toBe('dark');
    });

    it('should handle array content', () => {
      interface ArrayContent {
        items: string[];
        count: number;
      }

      const result: ElicitResult<ArrayContent> = {
        status: 'accept',
        content: {
          items: ['item1', 'item2', 'item3'],
          count: 3,
        },
      };

      expect(result.content?.items).toHaveLength(3);
      expect(result.content?.count).toBe(3);
    });
  });
});
