/**
 * Tests for tool-call.errors.ts
 */

import {
  TOOL_CALL_ERROR_CODES,
  createToolCallError,
  SelfReferenceError,
  ToolAccessDeniedError,
  ToolNotFoundError,
} from '../errors/tool-call.errors';

describe('TOOL_CALL_ERROR_CODES', () => {
  it('should have all expected error codes', () => {
    expect(TOOL_CALL_ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(TOOL_CALL_ERROR_CODES.VALIDATION).toBe('VALIDATION');
    expect(TOOL_CALL_ERROR_CODES.EXECUTION).toBe('EXECUTION');
    expect(TOOL_CALL_ERROR_CODES.TIMEOUT).toBe('TIMEOUT');
    expect(TOOL_CALL_ERROR_CODES.ACCESS_DENIED).toBe('ACCESS_DENIED');
    expect(TOOL_CALL_ERROR_CODES.SELF_REFERENCE).toBe('SELF_REFERENCE');
  });
});

describe('createToolCallError', () => {
  describe('NOT_FOUND error', () => {
    it('should create error with default message', () => {
      const error = createToolCallError('NOT_FOUND', 'users:get');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.toolName).toBe('users:get');
      expect(error.message).toBe('Tool "users:get" was not found');
    });

    it('should ignore raw message for NOT_FOUND', () => {
      const error = createToolCallError('NOT_FOUND', 'test:tool', 'internal error details');
      expect(error.message).toBe('Tool "test:tool" was not found');
    });
  });

  describe('VALIDATION error', () => {
    it('should create error with default message when no raw message', () => {
      const error = createToolCallError('VALIDATION', 'users:create');
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toBe('Input validation failed for tool "users:create"');
    });

    it('should sanitize validation message', () => {
      const rawMessage = 'Field "email" is required';
      const error = createToolCallError('VALIDATION', 'users:create', rawMessage);
      expect(error.message).toBe('Field "email" is required');
    });

    it('should remove file paths from validation message', () => {
      const rawMessage = 'Error in /home/user/app/lib/validator.ts';
      const error = createToolCallError('VALIDATION', 'test:tool', rawMessage);
      expect(error.message).toBe('Error in [path]');
    });

    it('should remove Windows file paths', () => {
      const rawMessage = 'Error at C:\\Users\\test\\app\\file.ts';
      const error = createToolCallError('VALIDATION', 'test:tool', rawMessage);
      expect(error.message).toBe('Error at [path]');
    });

    it('should remove line numbers', () => {
      const rawMessage = 'Error at line 42';
      const error = createToolCallError('VALIDATION', 'test:tool', rawMessage);
      expect(error.message).toBe('Error');
    });

    it('should remove line:column format', () => {
      const rawMessage = 'Error at :15:8';
      const error = createToolCallError('VALIDATION', 'test:tool', rawMessage);
      expect(error.message).toBe('Error at');
    });

    it('should remove stack trace lines', () => {
      const rawMessage = 'Error occurred\n    at Function.validate (/path/file.ts:10:5)';
      const error = createToolCallError('VALIDATION', 'test:tool', rawMessage);
      expect(error.message).not.toContain('at Function.validate');
    });

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(300);
      const error = createToolCallError('VALIDATION', 'test:tool', longMessage);
      expect(error.message.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(error.message).toContain('...');
    });
  });

  describe('EXECUTION error', () => {
    it('should create error with default message', () => {
      const error = createToolCallError('EXECUTION', 'users:update');
      expect(error.code).toBe('EXECUTION');
      expect(error.message).toBe('Tool "users:update" execution failed');
    });

    it('should ignore raw message for EXECUTION', () => {
      const error = createToolCallError('EXECUTION', 'test:tool', 'internal error details');
      expect(error.message).toBe('Tool "test:tool" execution failed');
    });
  });

  describe('TIMEOUT error', () => {
    it('should create error with default message', () => {
      const error = createToolCallError('TIMEOUT', 'slow:operation');
      expect(error.code).toBe('TIMEOUT');
      expect(error.message).toBe('Tool "slow:operation" execution timed out');
    });
  });

  describe('ACCESS_DENIED error', () => {
    it('should create error with default message', () => {
      const error = createToolCallError('ACCESS_DENIED', 'admin:delete');
      expect(error.code).toBe('ACCESS_DENIED');
      expect(error.message).toBe('Access denied for tool "admin:delete"');
    });
  });

  describe('SELF_REFERENCE error', () => {
    it('should create error with default message', () => {
      const error = createToolCallError('SELF_REFERENCE', 'codecall:execute');
      expect(error.code).toBe('SELF_REFERENCE');
      expect(error.message).toBe('Cannot call CodeCall tools from within AgentScript');
    });
  });

  describe('error immutability', () => {
    it('should freeze the error object', () => {
      const error = createToolCallError('NOT_FOUND', 'test:tool');
      expect(Object.isFrozen(error)).toBe(true);
    });
  });

  describe('unknown error code', () => {
    it('should create error with generic message', () => {
      const error = createToolCallError('UNKNOWN' as any, 'test:tool');
      expect(error.message).toBe('An error occurred while calling "test:tool"');
    });
  });
});

describe('SelfReferenceError', () => {
  it('should create error with correct properties', () => {
    const error = new SelfReferenceError('codecall:execute');
    expect(error.name).toBe('SelfReferenceError');
    expect(error.code).toBe('SELF_REFERENCE');
    expect(error.toolName).toBe('codecall:execute');
    expect(error.message).toBe(
      'Self-reference attack: Attempted to call CodeCall tool "codecall:execute" from within AgentScript',
    );
  });

  it('should be an instance of Error', () => {
    const error = new SelfReferenceError('codecall:search');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be frozen', () => {
    const error = new SelfReferenceError('codecall:invoke');
    expect(Object.isFrozen(error)).toBe(true);
  });
});

describe('ToolAccessDeniedError', () => {
  it('should create error with correct properties', () => {
    const error = new ToolAccessDeniedError('admin:delete', 'User lacks admin role');
    expect(error.name).toBe('ToolAccessDeniedError');
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.toolName).toBe('admin:delete');
    expect(error.reason).toBe('User lacks admin role');
    expect(error.message).toBe('Access denied for tool "admin:delete": User lacks admin role');
  });

  it('should be an instance of Error', () => {
    const error = new ToolAccessDeniedError('secret:tool', 'Unauthorized');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ToolNotFoundError', () => {
  it('should create error with correct properties', () => {
    const error = new ToolNotFoundError('nonexistent:tool');
    expect(error.name).toBe('ToolNotFoundError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.toolName).toBe('nonexistent:tool');
    expect(error.message).toBe('Tool "nonexistent:tool" not found');
  });

  it('should be an instance of Error', () => {
    const error = new ToolNotFoundError('missing:tool');
    expect(error).toBeInstanceOf(Error);
  });
});
