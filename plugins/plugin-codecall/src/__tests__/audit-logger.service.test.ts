/**
 * Tests for audit-logger.service.ts
 */

import { AuditLoggerService, AUDIT_EVENT_TYPES, AuditEvent } from '../services/audit-logger.service';

describe('AUDIT_EVENT_TYPES', () => {
  it('should have all execution event types', () => {
    expect(AUDIT_EVENT_TYPES.EXECUTION_START).toBe('codecall:execution:start');
    expect(AUDIT_EVENT_TYPES.EXECUTION_SUCCESS).toBe('codecall:execution:success');
    expect(AUDIT_EVENT_TYPES.EXECUTION_FAILURE).toBe('codecall:execution:failure');
    expect(AUDIT_EVENT_TYPES.EXECUTION_TIMEOUT).toBe('codecall:execution:timeout');
  });

  it('should have all tool call event types', () => {
    expect(AUDIT_EVENT_TYPES.TOOL_CALL_START).toBe('codecall:tool:call:start');
    expect(AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS).toBe('codecall:tool:call:success');
    expect(AUDIT_EVENT_TYPES.TOOL_CALL_FAILURE).toBe('codecall:tool:call:failure');
  });

  it('should have all security event types', () => {
    expect(AUDIT_EVENT_TYPES.SECURITY_SELF_REFERENCE).toBe('codecall:security:self-reference');
    expect(AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED).toBe('codecall:security:access-denied');
    expect(AUDIT_EVENT_TYPES.SECURITY_AST_BLOCKED).toBe('codecall:security:ast-blocked');
  });

  it('should have all meta-tool event types', () => {
    expect(AUDIT_EVENT_TYPES.SEARCH_PERFORMED).toBe('codecall:search:performed');
    expect(AUDIT_EVENT_TYPES.DESCRIBE_PERFORMED).toBe('codecall:describe:performed');
    expect(AUDIT_EVENT_TYPES.INVOKE_PERFORMED).toBe('codecall:invoke:performed');
  });
});

describe('AuditLoggerService', () => {
  let logger: AuditLoggerService;
  let receivedEvents: AuditEvent[];

  beforeEach(() => {
    logger = new AuditLoggerService();
    receivedEvents = [];
  });

  describe('subscribe', () => {
    it('should add listener and receive events', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_1', 'return 1;');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.EXECUTION_START);
    });

    it('should return unsubscribe function', () => {
      const unsubscribe = logger.subscribe((event) => receivedEvents.push(event));

      logger.logExecutionStart('exec_1', 'return 1;');
      expect(receivedEvents).toHaveLength(1);

      unsubscribe();
      logger.logExecutionStart('exec_2', 'return 2;');
      expect(receivedEvents).toHaveLength(1);
    });

    it('should support multiple listeners', () => {
      const listener1Events: AuditEvent[] = [];
      const listener2Events: AuditEvent[] = [];

      logger.subscribe((event) => listener1Events.push(event));
      logger.subscribe((event) => listener2Events.push(event));

      logger.logExecutionStart('exec_1', 'return 1;');

      expect(listener1Events).toHaveLength(1);
      expect(listener2Events).toHaveLength(1);
    });

    it('should not propagate listener errors', () => {
      logger.subscribe(() => {
        throw new Error('Listener error');
      });
      logger.subscribe((event) => receivedEvents.push(event));

      expect(() => logger.logExecutionStart('exec_1', 'return 1;')).not.toThrow();
      expect(receivedEvents).toHaveLength(1);
    });
  });

  describe('generateExecutionId', () => {
    it('should generate unique IDs', () => {
      const id1 = logger.generateExecutionId();
      const id2 = logger.generateExecutionId();

      expect(id1).not.toBe(id2);
    });

    it('should start with exec_ prefix', () => {
      const id = logger.generateExecutionId();
      expect(id.startsWith('exec_')).toBe(true);
    });

    it('should contain timestamp and counter', () => {
      const id = logger.generateExecutionId();
      const parts = id.split('_');
      expect(parts.length).toBe(4);
    });
  });

  describe('logExecutionStart', () => {
    it('should emit EXECUTION_START event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_123', 'const x = 1;');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.EXECUTION_START);
      expect(receivedEvents[0].executionId).toBe('exec_123');
    });

    it('should include script hash and length', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_123', 'const x = 1;');

      const data = receivedEvents[0].data as any;
      expect(data.scriptHash).toMatch(/^sh_[0-9a-f]{8}$/);
      expect(data.scriptLength).toBe(12);
    });

    it('should include timestamp', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_123', 'return 1;');

      expect(receivedEvents[0].timestamp).toBeDefined();
      expect(new Date(receivedEvents[0].timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe('logExecutionSuccess', () => {
    it('should emit EXECUTION_SUCCESS event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionSuccess('exec_123', 'return 1;', 100, 5);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.EXECUTION_SUCCESS);
      expect(receivedEvents[0].durationMs).toBe(100);
    });

    it('should include tool call count', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionSuccess('exec_123', 'return 1;', 100, 5);

      const data = receivedEvents[0].data as any;
      expect(data.toolCallCount).toBe(5);
    });
  });

  describe('logExecutionFailure', () => {
    it('should emit EXECUTION_FAILURE event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionFailure('exec_123', 'bad code', 50, 'Syntax error');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.EXECUTION_FAILURE);
    });

    it('should include sanitized error', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionFailure('exec_123', 'code', 50, 'Error in /home/user/file.ts:10:5');

      const data = receivedEvents[0].data as any;
      expect(data.error).toContain('[path]');
      expect(data.error).not.toContain('/home/user');
    });
  });

  describe('logExecutionTimeout', () => {
    it('should emit EXECUTION_TIMEOUT event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionTimeout('exec_123', 'slow code', 30000);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.EXECUTION_TIMEOUT);
      expect(receivedEvents[0].durationMs).toBe(30000);
    });
  });

  describe('logToolCallStart', () => {
    it('should emit TOOL_CALL_START event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logToolCallStart('exec_123', 'users:get', 0);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.TOOL_CALL_START);
      const data = receivedEvents[0].data as any;
      expect(data.toolName).toBe('users:get');
      expect(data.callDepth).toBe(0);
    });
  });

  describe('logToolCallSuccess', () => {
    it('should emit TOOL_CALL_SUCCESS event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logToolCallSuccess('exec_123', 'users:get', 0, 50);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS);
      expect(receivedEvents[0].durationMs).toBe(50);
    });
  });

  describe('logToolCallFailure', () => {
    it('should emit TOOL_CALL_FAILURE event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logToolCallFailure('exec_123', 'users:get', 0, 50, 'NOT_FOUND');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.TOOL_CALL_FAILURE);
      const data = receivedEvents[0].data as any;
      expect(data.errorCode).toBe('NOT_FOUND');
    });
  });

  describe('logSecuritySelfReference', () => {
    it('should emit SECURITY_SELF_REFERENCE event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logSecuritySelfReference('exec_123', 'codecall:execute');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.SECURITY_SELF_REFERENCE);
      const data = receivedEvents[0].data as any;
      expect(data.blocked).toBe('codecall:execute');
      expect(data.reason).toContain('Self-reference');
    });
  });

  describe('logSecurityAccessDenied', () => {
    it('should emit SECURITY_ACCESS_DENIED event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logSecurityAccessDenied('exec_123', 'admin:delete', 'Not authorized');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED);
      const data = receivedEvents[0].data as any;
      expect(data.blocked).toBe('admin:delete');
      expect(data.reason).toBe('Not authorized');
    });

    it('should sanitize reason', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logSecurityAccessDenied('exec_123', 'tool', 'Error at /path/to/file.ts:10:5');

      const data = receivedEvents[0].data as any;
      expect(data.reason).toContain('[path]');
    });
  });

  describe('logSecurityAstBlocked', () => {
    it('should emit SECURITY_AST_BLOCKED event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logSecurityAstBlocked('exec_123', 'eval()', 'Dangerous function');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.SECURITY_AST_BLOCKED);
      const data = receivedEvents[0].data as any;
      expect(data.blocked).toBe('eval()');
      expect(data.reason).toBe('Dangerous function');
    });
  });

  describe('logSearch', () => {
    it('should emit SEARCH_PERFORMED event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logSearch('exec_123', 'user management', 5, 50);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.SEARCH_PERFORMED);
      const data = receivedEvents[0].data as any;
      expect(data.queryLength).toBe(15);
      expect(data.resultCount).toBe(5);
    });
  });

  describe('logDescribe', () => {
    it('should emit DESCRIBE_PERFORMED event', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logDescribe('exec_123', ['users:get', 'users:create'], 30);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.DESCRIBE_PERFORMED);
      const data = receivedEvents[0].data as any;
      expect(data.toolCount).toBe(2);
      expect(data.toolNames).toEqual(['users:get', 'users:create']);
    });

    it('should limit tool names to 10', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const manyTools = Array(15)
        .fill(null)
        .map((_, i) => `tool:${i}`);
      logger.logDescribe('exec_123', manyTools, 30);

      const data = receivedEvents[0].data as any;
      expect(data.toolNames.length).toBe(10);
      expect(data.toolCount).toBe(15);
    });
  });

  describe('logInvoke', () => {
    it('should emit INVOKE_PERFORMED event for success', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logInvoke('exec_123', 'users:get', true, 100);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe(AUDIT_EVENT_TYPES.INVOKE_PERFORMED);
      const data = receivedEvents[0].data as any;
      expect(data.toolName).toBe('users:get');
      expect(data.success).toBe(true);
    });

    it('should emit INVOKE_PERFORMED event for failure', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logInvoke('exec_123', 'users:get', false, 100);

      const data = receivedEvents[0].data as any;
      expect(data.success).toBe(false);
    });
  });

  describe('event immutability', () => {
    it('should freeze emitted events', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_123', 'return 1;');

      expect(Object.isFrozen(receivedEvents[0])).toBe(true);
      expect(Object.isFrozen(receivedEvents[0].data)).toBe(true);
    });
  });

  describe('sanitizeError', () => {
    it('should handle empty error', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionFailure('exec_123', 'code', 50, '');

      const data = receivedEvents[0].data as any;
      expect(data.error).toBe('Unknown error');
    });

    it('should truncate long errors', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const longError = 'a'.repeat(300);
      logger.logExecutionFailure('exec_123', 'code', 50, longError);

      const data = receivedEvents[0].data as any;
      expect(data.error.length).toBeLessThanOrEqual(203);
    });

    it('should remove stack traces from multi-line errors', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const errorWithStack = `Error: Something went wrong
    at functionName (/home/user/file.ts:10:5)
    at anotherFunction (/home/user/other.ts:20:3)
    at Object.<anonymous> (/home/user/index.ts:1:1)`;

      logger.logExecutionFailure('exec_123', 'code', 50, errorWithStack);

      const data = receivedEvents[0].data as any;
      expect(data.error).not.toContain('at functionName');
      expect(data.error).not.toContain('at anotherFunction');
      expect(data.error).not.toContain('/home/user');
      expect(data.error).toContain('Error: Something went wrong');
    });

    it('should remove line numbers independently from paths', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionFailure('exec_123', 'code', 50, 'Error at position :15:20 in the code');

      const data = receivedEvents[0].data as any;
      expect(data.error).not.toContain(':15:20');
      expect(data.error).toContain('Error at position');
    });

    it('should handle Windows-style paths', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionFailure('exec_123', 'code', 50, 'Error in C:\\Users\\test\\file.ts:10:5');

      const data = receivedEvents[0].data as any;
      expect(data.error).toContain('[path]');
      expect(data.error).not.toContain('C:\\Users');
    });
  });

  describe('hashScript edge cases', () => {
    it('should handle empty string', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      logger.logExecutionStart('exec_123', '');

      const data = receivedEvents[0].data as { scriptHash: string; scriptLength: number };
      expect(data.scriptHash).toMatch(/^sh_[0-9a-f]{8}$/);
      expect(data.scriptLength).toBe(0);
    });

    it('should handle very long strings', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const longScript = 'x'.repeat(100000);
      logger.logExecutionStart('exec_123', longScript);

      const data = receivedEvents[0].data as { scriptHash: string; scriptLength: number };
      expect(data.scriptHash).toMatch(/^sh_[0-9a-f]{8}$/);
      expect(data.scriptLength).toBe(100000);
    });

    it('should handle unicode characters', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const unicodeScript = '你好世界 🚀 émoji ñ αβγ';
      logger.logExecutionStart('exec_123', unicodeScript);

      const data = receivedEvents[0].data as { scriptHash: string; scriptLength: number };
      expect(data.scriptHash).toMatch(/^sh_[0-9a-f]{8}$/);
      expect(data.scriptLength).toBe(unicodeScript.length);
    });

    it('should produce consistent hash for same input', () => {
      logger.subscribe((event) => receivedEvents.push(event));
      const script = 'const x = 1;';

      logger.logExecutionStart('exec_1', script);
      logger.logExecutionStart('exec_2', script);

      const data1 = receivedEvents[0].data as { scriptHash: string };
      const data2 = receivedEvents[1].data as { scriptHash: string };
      expect(data1.scriptHash).toBe(data2.scriptHash);
    });

    it('should produce different hashes for different inputs', () => {
      logger.subscribe((event) => receivedEvents.push(event));

      logger.logExecutionStart('exec_1', 'const x = 1;');
      logger.logExecutionStart('exec_2', 'const y = 2;');

      const data1 = receivedEvents[0].data as { scriptHash: string };
      const data2 = receivedEvents[1].data as { scriptHash: string };
      expect(data1.scriptHash).not.toBe(data2.scriptHash);
    });
  });

  describe('generateExecutionId counter behavior', () => {
    it('should increment counter across many consecutive calls', () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(logger.generateExecutionId());
      }

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);
    });

    it('should maintain uniqueness even with rapid consecutive calls', () => {
      const ids: string[] = [];
      // Generate many IDs in rapid succession
      for (let i = 0; i < 1000; i++) {
        ids.push(logger.generateExecutionId());
      }

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(1000);
    });

    it('should have monotonically increasing counter component', () => {
      const id1 = logger.generateExecutionId();
      const id2 = logger.generateExecutionId();
      const id3 = logger.generateExecutionId();

      // Extract counter parts (second underscore-separated segment after exec_timestamp_)
      const counter1 = parseInt(id1.split('_')[2], 36);
      const counter2 = parseInt(id2.split('_')[2], 36);
      const counter3 = parseInt(id3.split('_')[2], 36);

      expect(counter2).toBe(counter1 + 1);
      expect(counter3).toBe(counter2 + 1);
    });
  });
});
