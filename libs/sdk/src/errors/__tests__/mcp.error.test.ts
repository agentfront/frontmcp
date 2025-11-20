// errors/__tests__/mcp.error.test.ts
import {
  ToolNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  ToolExecutionError,
  isPublicError,
  formatMcpErrorResponse,
} from '../mcp.error';

describe('MCP Error Handling', () => {
  describe('Public Errors', () => {
    it('should create ToolNotFoundError with correct properties', () => {
      const error = new ToolNotFoundError('my_tool');

      expect(error.isPublic).toBe(true);
      expect(error.code).toBe('TOOL_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Tool "my_tool" not found');
      expect(error.errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });

    it('should create InvalidInputError with validation details', () => {
      const validationErrors = [{ path: ['name'], message: 'Required' }];
      const error = new InvalidInputError('Validation failed', validationErrors);

      expect(error.isPublic).toBe(true);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.validationErrors).toEqual(validationErrors);
    });

    it('should expose public error message in both modes', () => {
      const error = new ToolNotFoundError('my_tool');

      const devResponse = error.toMcpError(true);
      const prodResponse = error.toMcpError(false);

      expect(devResponse.content[0].text).toBe('Tool "my_tool" not found');
      expect(prodResponse.content[0].text).toBe('Tool "my_tool" not found');
    });
  });

  describe('Internal Errors', () => {
    it('should create InvalidOutputError with correct properties', () => {
      const error = new InvalidOutputError();

      expect(error.isPublic).toBe(false);
      expect(error.code).toBe('INVALID_OUTPUT');
      expect(error.statusCode).toBe(500);
      expect(error.errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });

    it('should create ToolExecutionError with original error', () => {
      const originalError = new Error('DB connection failed');
      const error = new ToolExecutionError('my_tool', originalError);

      expect(error.isPublic).toBe(false);
      expect(error.code).toBe('TOOL_EXECUTION_ERROR');
      expect(error.originalError).toBe(originalError);
    });

    it('should hide internal details in production', () => {
      const error = new ToolExecutionError('my_tool', new Error('DB password is wrong'));

      const prodResponse = error.toMcpError(false);

      expect(prodResponse.content[0].text).toMatch(/Internal FrontMCP error/);
      expect(prodResponse.content[0].text).toMatch(/err_[a-f0-9]{16}/);
      expect(prodResponse.content[0].text).not.toMatch(/DB password/);
    });

    it('should expose internal details in development', () => {
      const error = new ToolExecutionError('my_tool', new Error('DB connection failed'));

      const devResponse = error.toMcpError(true);

      expect(devResponse.content[0].text).toMatch(/DB connection failed/);
    });
  });

  describe('Error Formatting', () => {
    it('should include error metadata', () => {
      const error = new ToolNotFoundError('my_tool');
      const response = error.toMcpError(false);

      expect(response.isError).toBe(true);
      expect(response._meta).toBeDefined();
      expect(response._meta?.errorId).toBe(error.errorId);
      expect(response._meta?.code).toBe('TOOL_NOT_FOUND');
      expect(response._meta?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include stack trace in development', () => {
      const error = new ToolNotFoundError('my_tool');
      const response = error.toMcpError(true);

      expect(response._meta?.stack).toBeDefined();
      expect(response._meta?.stack).toContain('ToolNotFoundError');
    });

    it('should exclude stack trace in production', () => {
      const error = new ToolNotFoundError('my_tool');
      const response = error.toMcpError(false);

      expect(response._meta?.stack).toBeUndefined();
    });

    it('should format validation errors properly', () => {
      const validationErrors = [
        { path: ['name'], message: 'Required' },
        { path: ['age'], message: 'Must be positive' },
      ];
      const error = new InvalidInputError('Validation failed', validationErrors);
      const response = error.toMcpError(false);

      expect(response.content[0].text).toContain('Validation failed');
      expect(response.content[0].text).toContain('name');
      expect(response.content[0].text).toContain('Required');
    });
  });

  describe('Error Utilities', () => {
    it('should identify public errors', () => {
      const publicError = new ToolNotFoundError('my_tool');
      const internalError = new InvalidOutputError();

      expect(isPublicError(publicError)).toBe(true);
      expect(isPublicError(internalError)).toBe(false);
    });

    it('should convert generic errors to MCP errors', () => {
      const genericError = new Error('Something went wrong');
      const response = formatMcpErrorResponse(genericError, false);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toMatch(/Internal FrontMCP error/);
      expect(response._meta?.code).toBe('SERVER_ERROR');
    });

    it('should preserve MCP errors when formatting', () => {
      const mcpError = new ToolNotFoundError('my_tool');
      const response = formatMcpErrorResponse(mcpError, false);

      expect(response.content[0].text).toBe('Tool "my_tool" not found');
      expect(response._meta?.code).toBe('TOOL_NOT_FOUND');
      expect(response._meta?.errorId).toBe(mcpError.errorId);
    });
  });

  describe('Error ID Generation', () => {
    it('should generate unique error IDs', () => {
      const error1 = new ToolNotFoundError('tool1');
      const error2 = new ToolNotFoundError('tool2');

      expect(error1.errorId).not.toBe(error2.errorId);
    });

    it('should allow custom error IDs', () => {
      const customId = 'err_custom123';
      const error = new InvalidOutputError(customId);

      expect(error.errorId).toBe(customId);
    });

    it('should format error IDs correctly', () => {
      const error = new ToolNotFoundError('my_tool');

      expect(error.errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });
  });

  describe('Error Inheritance', () => {
    it('should maintain instanceof checks', () => {
      const toolError = new ToolNotFoundError('my_tool');
      const inputError = new InvalidInputError('Bad input');
      const outputError = new InvalidOutputError();

      expect(toolError).toBeInstanceOf(Error);
      expect(toolError).toBeInstanceOf(ToolNotFoundError);
      expect(inputError).toBeInstanceOf(InvalidInputError);
      expect(outputError).toBeInstanceOf(InvalidOutputError);
    });

    it('should have correct error names', () => {
      const toolError = new ToolNotFoundError('my_tool');
      const inputError = new InvalidInputError('Bad input');

      expect(toolError.name).toBe('ToolNotFoundError');
      expect(inputError.name).toBe('InvalidInputError');
    });
  });

  describe('Environment-based Behavior', () => {
    const originalEnv = process.env['NODE_ENV'];

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
    });

    it('should use production mode when NODE_ENV is production', () => {
      process.env['NODE_ENV'] = 'production';
      const error = new InvalidOutputError();
      const response = formatMcpErrorResponse(error);

      expect(response._meta?.stack).toBeUndefined();
    });

    it('should use development mode when NODE_ENV is not production', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new InvalidOutputError();
      const response = formatMcpErrorResponse(error);

      expect(response._meta?.stack).toBeDefined();
    });
  });
});
