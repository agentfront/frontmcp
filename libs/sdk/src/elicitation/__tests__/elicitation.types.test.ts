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
  type PendingElicitFallback,
  type ResolvedElicitResult,
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

  describe('PendingElicitFallback', () => {
    it('should create a fallback record with all required fields', () => {
      const now = Date.now();
      const fallback: PendingElicitFallback = {
        elicitId: 'elicit-123',
        sessionId: 'session-456',
        toolName: 'myTool',
        toolInput: { key: 'value' },
        elicitMessage: 'Please confirm your action',
        elicitSchema: {
          type: 'object',
          properties: {
            confirmed: { type: 'boolean' },
          },
        },
        createdAt: now,
        expiresAt: now + 300000, // 5 minutes
      };

      expect(fallback.elicitId).toBe('elicit-123');
      expect(fallback.sessionId).toBe('session-456');
      expect(fallback.toolName).toBe('myTool');
      expect(fallback.toolInput).toEqual({ key: 'value' });
      expect(fallback.elicitMessage).toBe('Please confirm your action');
      expect(fallback.elicitSchema).toBeDefined();
      expect(fallback.expiresAt).toBeGreaterThan(fallback.createdAt);
    });

    it('should allow complex tool input', () => {
      const now = Date.now();
      const fallback: PendingElicitFallback = {
        elicitId: 'elicit-complex',
        sessionId: 'session-complex',
        toolName: 'complexTool',
        toolInput: {
          nested: { deep: { value: 123 } },
          array: [1, 2, 3],
          nullValue: null,
        },
        elicitMessage: 'Complex input test',
        elicitSchema: {},
        createdAt: now,
        expiresAt: now + 60000,
      };

      expect(fallback.toolInput).toEqual({
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        nullValue: null,
      });
    });

    it('should allow empty elicit schema', () => {
      const now = Date.now();
      const fallback: PendingElicitFallback = {
        elicitId: 'elicit-empty',
        sessionId: 'session-empty',
        toolName: 'simpleTool',
        toolInput: undefined,
        elicitMessage: 'Simple message',
        elicitSchema: {},
        createdAt: now,
        expiresAt: now + 30000,
      };

      expect(fallback.elicitSchema).toEqual({});
      expect(fallback.toolInput).toBeUndefined();
    });
  });

  describe('ResolvedElicitResult', () => {
    it('should create a resolved result with accept status and content', () => {
      const now = Date.now();
      const resolved: ResolvedElicitResult = {
        elicitId: 'elicit-123',
        result: {
          status: 'accept',
          content: { confirmed: true },
        },
        resolvedAt: now,
      };

      expect(resolved.elicitId).toBe('elicit-123');
      expect(resolved.result.status).toBe('accept');
      expect(resolved.result.content).toEqual({ confirmed: true });
      expect(resolved.resolvedAt).toBe(now);
    });

    it('should create a resolved result with cancel status', () => {
      const now = Date.now();
      const resolved: ResolvedElicitResult = {
        elicitId: 'elicit-cancel',
        result: {
          status: 'cancel',
        },
        resolvedAt: now,
      };

      expect(resolved.elicitId).toBe('elicit-cancel');
      expect(resolved.result.status).toBe('cancel');
      expect(resolved.result.content).toBeUndefined();
    });

    it('should create a resolved result with decline status', () => {
      const now = Date.now();
      const resolved: ResolvedElicitResult = {
        elicitId: 'elicit-decline',
        result: {
          status: 'decline',
        },
        resolvedAt: now,
      };

      expect(resolved.elicitId).toBe('elicit-decline');
      expect(resolved.result.status).toBe('decline');
      expect(resolved.result.content).toBeUndefined();
    });

    it('should allow complex content in accepted result', () => {
      const now = Date.now();
      const resolved: ResolvedElicitResult = {
        elicitId: 'elicit-complex',
        result: {
          status: 'accept',
          content: {
            user: { name: 'John', email: 'john@example.com' },
            permissions: ['read', 'write'],
            metadata: { timestamp: now },
          },
        },
        resolvedAt: now,
      };

      expect(resolved.result.status).toBe('accept');
      const content = resolved.result.content as {
        user: { name: string; email: string };
        permissions: string[];
        metadata: { timestamp: number };
      };
      expect(content.user.name).toBe('John');
      expect(content.permissions).toEqual(['read', 'write']);
    });
  });
});
