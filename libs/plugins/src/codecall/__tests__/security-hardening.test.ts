// file: libs/plugins/src/codecall/__tests__/security-hardening.test.ts

import { isBlockedSelfReference, assertNotSelfReference, getBlockedPatterns } from '../security/self-reference-guard';
import {
  createToolCallError,
  TOOL_CALL_ERROR_CODES,
  SelfReferenceError,
  ToolAccessDeniedError,
  ToolNotFoundError,
} from '../errors/tool-call.errors';
import { ToolAccessControlService, ToolAccessPolicy } from '../security/tool-access-control.service';

describe('CodeCall Security Hardening', () => {
  describe('Self-Reference Guard', () => {
    describe('isBlockedSelfReference', () => {
      it('should block codecall:execute', () => {
        expect(isBlockedSelfReference('codecall:execute')).toBe(true);
      });

      it('should block codecall:search', () => {
        expect(isBlockedSelfReference('codecall:search')).toBe(true);
      });

      it('should block codecall:describe', () => {
        expect(isBlockedSelfReference('codecall:describe')).toBe(true);
      });

      it('should block codecall:invoke', () => {
        expect(isBlockedSelfReference('codecall:invoke')).toBe(true);
      });

      it('should block any tool with codecall: prefix', () => {
        expect(isBlockedSelfReference('codecall:custom')).toBe(true);
        expect(isBlockedSelfReference('codecall:anything')).toBe(true);
        expect(isBlockedSelfReference('codecall:nested:tool')).toBe(true);
      });

      it('should block codecall: prefix case-insensitively', () => {
        expect(isBlockedSelfReference('CODECALL:execute')).toBe(true);
        expect(isBlockedSelfReference('CodeCall:Search')).toBe(true);
      });

      it('should allow non-codecall tools', () => {
        expect(isBlockedSelfReference('users:list')).toBe(false);
        expect(isBlockedSelfReference('billing:getInvoice')).toBe(false);
        expect(isBlockedSelfReference('my-app:doSomething')).toBe(false);
      });

      it('should allow tools that contain codecall but not as prefix', () => {
        expect(isBlockedSelfReference('myapp:codecall')).toBe(false);
        expect(isBlockedSelfReference('not-codecall:tool')).toBe(false);
      });
    });

    describe('assertNotSelfReference', () => {
      it('should throw SelfReferenceError for blocked tools', () => {
        expect(() => assertNotSelfReference('codecall:execute')).toThrow(SelfReferenceError);
        expect(() => assertNotSelfReference('codecall:search')).toThrow(SelfReferenceError);
      });

      it('should not throw for allowed tools', () => {
        expect(() => assertNotSelfReference('users:list')).not.toThrow();
        expect(() => assertNotSelfReference('billing:invoice')).not.toThrow();
      });

      it('should include tool name in error', () => {
        try {
          assertNotSelfReference('codecall:execute');
          fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(SelfReferenceError);
          expect((error as SelfReferenceError).toolName).toBe('codecall:execute');
        }
      });
    });

    describe('getBlockedPatterns', () => {
      it('should return the blocked prefix and explicit list', () => {
        const patterns = getBlockedPatterns();
        expect(patterns.prefix).toBe('codecall:');
        expect(patterns.explicit).toContain('codecall:execute');
        expect(patterns.explicit).toContain('codecall:search');
        expect(patterns.explicit).toContain('codecall:describe');
        expect(patterns.explicit).toContain('codecall:invoke');
      });
    });
  });

  describe('Tool Call Errors', () => {
    describe('createToolCallError', () => {
      it('should create a frozen error object', () => {
        const error = createToolCallError(TOOL_CALL_ERROR_CODES.NOT_FOUND, 'users:get');
        expect(Object.isFrozen(error)).toBe(true);
      });

      it('should sanitize error messages - no file paths', () => {
        const error = createToolCallError(
          TOOL_CALL_ERROR_CODES.VALIDATION,
          'users:get',
          'Error at /Users/david/project/src/file.ts:42:10',
        );
        expect(error.message).not.toContain('/Users/');
        expect(error.message).not.toContain(':42:10');
      });

      it('should sanitize error messages - no stack traces', () => {
        const error = createToolCallError(
          TOOL_CALL_ERROR_CODES.VALIDATION,
          'users:get',
          'Error\n    at Function.validate (file.js:10:5)\n    at Object.run (test.js:20:3)',
        );
        expect(error.message).not.toContain('at Function.validate');
        expect(error.message).not.toContain('at Object.run');
      });

      it('should truncate very long messages', () => {
        const longMessage = 'x'.repeat(500);
        const error = createToolCallError(TOOL_CALL_ERROR_CODES.VALIDATION, 'users:get', longMessage);
        expect(error.message.length).toBeLessThanOrEqual(203); // 200 + "..."
      });

      it('should provide generic messages for each error code', () => {
        const notFoundError = createToolCallError(TOOL_CALL_ERROR_CODES.NOT_FOUND, 'users:get');
        expect(notFoundError.message).toContain('not found');

        const accessDeniedError = createToolCallError(TOOL_CALL_ERROR_CODES.ACCESS_DENIED, 'admin:delete');
        expect(accessDeniedError.message).toContain('Access denied');

        const timeoutError = createToolCallError(TOOL_CALL_ERROR_CODES.TIMEOUT, 'slow:tool');
        expect(timeoutError.message).toContain('timed out');
      });

      it('should never expose internal details', () => {
        const error = createToolCallError(
          TOOL_CALL_ERROR_CODES.EXECUTION,
          'users:get',
          'Internal server error: database connection failed to postgres://user:password@host:5432/db',
        );
        // The message should be generic, not exposing connection details
        expect(error.message).not.toContain('postgres://');
        expect(error.message).not.toContain('password');
      });
    });

    describe('SelfReferenceError', () => {
      it('should have correct code', () => {
        const error = new SelfReferenceError('codecall:execute');
        expect(error.code).toBe(TOOL_CALL_ERROR_CODES.SELF_REFERENCE);
      });

      it('should be frozen', () => {
        const error = new SelfReferenceError('codecall:execute');
        expect(Object.isFrozen(error)).toBe(true);
      });

      it('should store tool name', () => {
        const error = new SelfReferenceError('codecall:execute');
        expect(error.toolName).toBe('codecall:execute');
      });
    });

    describe('ToolAccessDeniedError', () => {
      it('should have correct code', () => {
        const error = new ToolAccessDeniedError('admin:delete', 'Not authorized');
        expect(error.code).toBe(TOOL_CALL_ERROR_CODES.ACCESS_DENIED);
      });

      it('should store tool name and reason', () => {
        const error = new ToolAccessDeniedError('admin:delete', 'Not authorized');
        expect(error.toolName).toBe('admin:delete');
        expect(error.reason).toBe('Not authorized');
      });
    });

    describe('ToolNotFoundError', () => {
      it('should have correct code', () => {
        const error = new ToolNotFoundError('unknown:tool');
        expect(error.code).toBe(TOOL_CALL_ERROR_CODES.NOT_FOUND);
      });

      it('should store tool name', () => {
        const error = new ToolNotFoundError('unknown:tool');
        expect(error.toolName).toBe('unknown:tool');
      });
    });
  });

  describe('Tool Access Control Service', () => {
    describe('blacklist mode (default)', () => {
      it('should allow tools not in blacklist', async () => {
        const service = new ToolAccessControlService({ mode: 'blacklist' });
        const decision = await service.checkAccess('users:list');
        expect(decision.allowed).toBe(true);
      });

      it('should block tools in explicit blacklist', async () => {
        const service = new ToolAccessControlService({
          mode: 'blacklist',
          blacklist: ['admin:delete', 'admin:destroy'],
        });
        const decision = await service.checkAccess('admin:delete');
        expect(decision.allowed).toBe(false);
      });

      it('should block tools matching blacklist patterns', async () => {
        const service = new ToolAccessControlService({
          mode: 'blacklist',
          blacklist: ['admin:*'],
        });
        expect((await service.checkAccess('admin:delete')).allowed).toBe(false);
        expect((await service.checkAccess('admin:create')).allowed).toBe(false);
        expect((await service.checkAccess('users:list')).allowed).toBe(true);
      });

      it('should always block default blacklist (system:*, internal:*)', async () => {
        const service = new ToolAccessControlService({ mode: 'blacklist' });
        expect((await service.checkAccess('system:reboot')).allowed).toBe(false);
        expect((await service.checkAccess('internal:debug')).allowed).toBe(false);
      });
    });

    describe('whitelist mode', () => {
      it('should block tools not in whitelist', async () => {
        const service = new ToolAccessControlService({
          mode: 'whitelist',
          whitelist: ['users:list', 'users:get'],
        });
        const decision = await service.checkAccess('admin:delete');
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not in whitelist');
      });

      it('should allow tools in explicit whitelist', async () => {
        const service = new ToolAccessControlService({
          mode: 'whitelist',
          whitelist: ['users:list', 'users:get'],
        });
        expect((await service.checkAccess('users:list')).allowed).toBe(true);
        expect((await service.checkAccess('users:get')).allowed).toBe(true);
      });

      it('should allow tools matching whitelist patterns', async () => {
        const service = new ToolAccessControlService({
          mode: 'whitelist',
          whitelist: ['users:*'],
        });
        expect((await service.checkAccess('users:list')).allowed).toBe(true);
        expect((await service.checkAccess('users:create')).allowed).toBe(true);
        expect((await service.checkAccess('admin:delete')).allowed).toBe(false);
      });
    });

    describe('pattern rules', () => {
      it('should deny patterns have highest priority', async () => {
        const service = new ToolAccessControlService({
          mode: 'blacklist',
          patterns: {
            deny: ['*:delete'],
          },
        });
        expect((await service.checkAccess('users:delete')).allowed).toBe(false);
        expect((await service.checkAccess('admin:delete')).allowed).toBe(false);
        expect((await service.checkAccess('users:list')).allowed).toBe(true);
      });

      it('should allow patterns work in whitelist mode', async () => {
        const service = new ToolAccessControlService({
          mode: 'whitelist',
          patterns: {
            allow: ['users:*', 'public:*'],
          },
        });
        expect((await service.checkAccess('users:list')).allowed).toBe(true);
        expect((await service.checkAccess('public:info')).allowed).toBe(true);
        expect((await service.checkAccess('admin:delete')).allowed).toBe(false);
      });
    });

    describe('dynamic mode', () => {
      it('should call evaluator function', async () => {
        const evaluator = jest.fn().mockResolvedValue({ allowed: true });
        const service = new ToolAccessControlService({
          mode: 'dynamic',
          evaluator,
        });

        await service.checkAccess('users:list', { callDepth: 1 });

        expect(evaluator).toHaveBeenCalledWith(
          expect.objectContaining({
            toolName: 'users:list',
            callDepth: 1,
          }),
        );
      });

      it('should deny if no evaluator configured', async () => {
        const service = new ToolAccessControlService({ mode: 'dynamic' });
        const decision = await service.checkAccess('users:list');
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('No dynamic evaluator');
      });

      it('should respect evaluator decision', async () => {
        const service = new ToolAccessControlService({
          mode: 'dynamic',
          evaluator: async (ctx) => ({
            allowed: ctx.toolName.startsWith('allowed:'),
          }),
        });

        expect((await service.checkAccess('allowed:tool')).allowed).toBe(true);
        expect((await service.checkAccess('blocked:tool')).allowed).toBe(false);
      });
    });

    describe('getPolicy', () => {
      it('should return frozen policy', () => {
        const service = new ToolAccessControlService({
          mode: 'blacklist',
          blacklist: ['admin:*'],
        });
        const policy = service.getPolicy();
        expect(Object.isFrozen(policy)).toBe(true);
        expect(policy.mode).toBe('blacklist');
      });
    });
  });

  describe('Error Isolation', () => {
    it('should not expose internal error details through sanitization', () => {
      // Simulate various internal error messages
      const internalErrors = [
        'TypeError: Cannot read property "x" of undefined at /app/src/internal.ts:42:10',
        'Error: ECONNREFUSED 127.0.0.1:5432',
        'MongoError: Authentication failed for user "admin"',
        'Error: Secret key not found in environment variable API_SECRET_KEY',
      ];

      for (const internalError of internalErrors) {
        const sanitized = createToolCallError(TOOL_CALL_ERROR_CODES.EXECUTION, 'test:tool', internalError);

        // Should NOT contain sensitive information
        expect(sanitized.message).not.toContain('/app/src/');
        expect(sanitized.message).not.toContain('127.0.0.1');
        expect(sanitized.message).not.toContain('admin');
        expect(sanitized.message).not.toContain('API_SECRET_KEY');
        expect(sanitized.message).not.toContain(':42:10');
      }
    });
  });
});
