/**
 * Tests for elicitation types.
 */
import {
  DEFAULT_ELICIT_TTL,
  type ElicitStatus,
  type ElicitResult,
  type ElicitMode,
  type ElicitOptions,
  type TypedElicitResult,
  type PendingElicit,
} from '../elicitation.types';
import { z } from 'zod';

describe('Elicitation Types', () => {
  describe('DEFAULT_ELICIT_TTL', () => {
    it('should be 5 minutes (300000ms)', () => {
      expect(DEFAULT_ELICIT_TTL).toBe(300000);
    });

    it('should be a number', () => {
      expect(typeof DEFAULT_ELICIT_TTL).toBe('number');
    });
  });

  describe('ElicitStatus', () => {
    it('should accept "accept" as a valid status', () => {
      const status: ElicitStatus = 'accept';
      expect(status).toBe('accept');
    });

    it('should accept "cancel" as a valid status', () => {
      const status: ElicitStatus = 'cancel';
      expect(status).toBe('cancel');
    });

    it('should accept "decline" as a valid status', () => {
      const status: ElicitStatus = 'decline';
      expect(status).toBe('decline');
    });
  });

  describe('ElicitResult', () => {
    it('should create a result with accept status and content', () => {
      const result: ElicitResult<{ confirmed: boolean }> = {
        status: 'accept',
        content: { confirmed: true },
      };

      expect(result.status).toBe('accept');
      expect(result.content).toEqual({ confirmed: true });
    });

    it('should create a result with cancel status without content', () => {
      const result: ElicitResult = {
        status: 'cancel',
      };

      expect(result.status).toBe('cancel');
      expect(result.content).toBeUndefined();
    });

    it('should create a result with decline status without content', () => {
      const result: ElicitResult = {
        status: 'decline',
      };

      expect(result.status).toBe('decline');
      expect(result.content).toBeUndefined();
    });

    it('should allow generic content type', () => {
      interface UserResponse {
        name: string;
        age: number;
        confirmed: boolean;
      }

      const result: ElicitResult<UserResponse> = {
        status: 'accept',
        content: {
          name: 'John',
          age: 30,
          confirmed: true,
        },
      };

      expect(result.content?.name).toBe('John');
      expect(result.content?.age).toBe(30);
      expect(result.content?.confirmed).toBe(true);
    });

    it('should default to unknown content type', () => {
      const result: ElicitResult = {
        status: 'accept',
        content: { anything: 'goes' },
      };

      expect(result.status).toBe('accept');
      expect(result.content).toEqual({ anything: 'goes' });
    });
  });

  describe('ElicitMode', () => {
    it('should accept "form" as a valid mode', () => {
      const mode: ElicitMode = 'form';
      expect(mode).toBe('form');
    });

    it('should accept "url" as a valid mode', () => {
      const mode: ElicitMode = 'url';
      expect(mode).toBe('url');
    });
  });

  describe('ElicitOptions', () => {
    it('should create options with default mode', () => {
      const options: ElicitOptions = {};
      expect(options.mode).toBeUndefined();
    });

    it('should create options with form mode', () => {
      const options: ElicitOptions = {
        mode: 'form',
      };
      expect(options.mode).toBe('form');
    });

    it('should create options with url mode and elicitationId', () => {
      const options: ElicitOptions = {
        mode: 'url',
        elicitationId: 'elicit-123',
      };

      expect(options.mode).toBe('url');
      expect(options.elicitationId).toBe('elicit-123');
    });

    it('should create options with custom ttl', () => {
      const options: ElicitOptions = {
        ttl: 60000, // 1 minute
      };

      expect(options.ttl).toBe(60000);
    });

    it('should create options with all fields', () => {
      const options: ElicitOptions = {
        mode: 'form',
        ttl: 120000,
        elicitationId: 'test-elicit',
      };

      expect(options.mode).toBe('form');
      expect(options.ttl).toBe(120000);
      expect(options.elicitationId).toBe('test-elicit');
    });
  });

  describe('TypedElicitResult', () => {
    it('should infer type from Zod schema', () => {
      const schema = z.object({
        confirmed: z.boolean(),
        reason: z.string().optional(),
      });

      // TypedElicitResult should infer the schema type
      const result: TypedElicitResult<typeof schema> = {
        status: 'accept',
        content: {
          confirmed: true,
          reason: 'User approved',
        },
      };

      expect(result.status).toBe('accept');
      expect(result.content?.confirmed).toBe(true);
      expect(result.content?.reason).toBe('User approved');
    });

    it('should work with complex Zod schemas', () => {
      const schema = z.object({
        action: z.enum(['approve', 'reject', 'defer']),
        metadata: z.object({
          timestamp: z.number(),
          userId: z.string(),
        }),
      });

      const result: TypedElicitResult<typeof schema> = {
        status: 'accept',
        content: {
          action: 'approve',
          metadata: {
            timestamp: Date.now(),
            userId: 'user-123',
          },
        },
      };

      expect(result.content?.action).toBe('approve');
      expect(result.content?.metadata.userId).toBe('user-123');
    });
  });

  describe('PendingElicit', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should create a pending elicit with all required fields', () => {
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeoutHandle = setTimeout(() => {}, 1000);

      const pending: PendingElicit<{ confirmed: boolean }> = {
        elicitId: 'elicit-abc',
        timeoutHandle,
        resolve: resolveFn,
        reject: rejectFn,
      };

      expect(pending.elicitId).toBe('elicit-abc');
      expect(pending.timeoutHandle).toBeDefined();
      expect(pending.resolve).toBe(resolveFn);
      expect(pending.reject).toBe(rejectFn);
    });

    it('should be callable with resolve function', () => {
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeoutHandle = setTimeout(() => {}, 1000);

      const pending: PendingElicit<{ value: string }> = {
        elicitId: 'test',
        timeoutHandle,
        resolve: resolveFn,
        reject: rejectFn,
      };

      pending.resolve({ status: 'accept', content: { value: 'test-value' } });

      expect(resolveFn).toHaveBeenCalledWith({
        status: 'accept',
        content: { value: 'test-value' },
      });
    });

    it('should be callable with reject function', () => {
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeoutHandle = setTimeout(() => {}, 1000);

      const pending: PendingElicit = {
        elicitId: 'test',
        timeoutHandle,
        resolve: resolveFn,
        reject: rejectFn,
      };

      const error = new Error('Test error');
      pending.reject(error);

      expect(rejectFn).toHaveBeenCalledWith(error);
    });
  });
});
