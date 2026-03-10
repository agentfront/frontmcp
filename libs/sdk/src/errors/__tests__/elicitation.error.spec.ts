/**
 * Tests for elicitation error classes.
 */
import { ElicitationNotSupportedError, ElicitationTimeoutError } from '../elicitation.error';
import { PublicMcpError } from '../mcp.error';

describe('Elicitation Errors', () => {
  describe('ElicitationNotSupportedError', () => {
    it('should create error with default message', () => {
      const error = new ElicitationNotSupportedError();

      expect(error.message).toBe('Client does not support elicitation');
      expect(error.code).toBe('ELICITATION_NOT_SUPPORTED');
      expect(error.statusCode).toBe(400);
    });

    it('should create error with custom message', () => {
      const customMessage = 'Client does not support form-based elicitation';
      const error = new ElicitationNotSupportedError(customMessage);

      expect(error.message).toBe(customMessage);
      expect(error.code).toBe('ELICITATION_NOT_SUPPORTED');
    });

    it('should be an instance of PublicMcpError', () => {
      const error = new ElicitationNotSupportedError();

      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should be a public error', () => {
      const error = new ElicitationNotSupportedError();

      expect(error.isPublic).toBe(true);
    });

    it('should have correct error name', () => {
      const error = new ElicitationNotSupportedError();

      expect(error.name).toBe('ElicitationNotSupportedError');
    });

    it('should have a unique error ID', () => {
      const error1 = new ElicitationNotSupportedError();
      const error2 = new ElicitationNotSupportedError();

      expect(error1.errorId).not.toBe(error2.errorId);
      expect(error1.errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });

    it('should convert to MCP error format', () => {
      const error = new ElicitationNotSupportedError();
      const mcpError = error.toMcpError(false);

      expect(mcpError.isError).toBe(true);
      expect(mcpError.content[0].text).toContain('elicitation');
      expect(mcpError._meta?.code).toBe('ELICITATION_NOT_SUPPORTED');
    });

    it('should expose public message in both dev and prod modes', () => {
      const error = new ElicitationNotSupportedError('Custom elicitation error');

      const devResponse = error.toMcpError(true);
      const prodResponse = error.toMcpError(false);

      expect(devResponse.content[0].text).toBe('Custom elicitation error');
      expect(prodResponse.content[0].text).toBe('Custom elicitation error');
    });
  });

  describe('ElicitationTimeoutError', () => {
    it('should create error with elicitId and ttl', () => {
      const error = new ElicitationTimeoutError('elicit-123', 300000);

      expect(error.elicitId).toBe('elicit-123');
      expect(error.ttl).toBe(300000);
      expect(error.message).toBe('Elicitation request timed out after 300000ms');
      expect(error.code).toBe('ELICITATION_TIMEOUT');
      expect(error.statusCode).toBe(408);
    });

    it('should be an instance of PublicMcpError', () => {
      const error = new ElicitationTimeoutError('elicit-abc', 60000);

      expect(error).toBeInstanceOf(PublicMcpError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should be a public error', () => {
      const error = new ElicitationTimeoutError('test', 1000);

      expect(error.isPublic).toBe(true);
    });

    it('should have correct error name', () => {
      const error = new ElicitationTimeoutError('test', 5000);

      expect(error.name).toBe('ElicitationTimeoutError');
    });

    it('should have a unique error ID', () => {
      const error1 = new ElicitationTimeoutError('elicit-1', 1000);
      const error2 = new ElicitationTimeoutError('elicit-2', 1000);

      expect(error1.errorId).not.toBe(error2.errorId);
      expect(error1.errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });

    it('should provide human-readable public message', () => {
      const error = new ElicitationTimeoutError('elicit-test', 300000); // 5 minutes

      const publicMessage = error.getPublicMessage();

      expect(publicMessage).toContain('timed out');
      expect(publicMessage).toContain('300 seconds');
    });

    it('should convert ttl to seconds in public message', () => {
      const error = new ElicitationTimeoutError('test', 60000); // 1 minute

      const publicMessage = error.getPublicMessage();

      expect(publicMessage).toContain('60 seconds');
    });

    it('should convert to MCP error format', () => {
      const error = new ElicitationTimeoutError('elicit-456', 120000);
      const mcpError = error.toMcpError(false);

      expect(mcpError.isError).toBe(true);
      expect(mcpError.content[0].text).toContain('timed out');
      expect(mcpError._meta?.code).toBe('ELICITATION_TIMEOUT');
    });

    it('should expose public message in production mode', () => {
      const error = new ElicitationTimeoutError('test', 60000);

      const prodResponse = error.toMcpError(false);

      // Production should show public message with seconds
      expect(prodResponse.content[0].text).toContain('60 seconds');
    });

    it('should include elicitId and ttl properties', () => {
      const elicitId = 'custom-elicit-id';
      const ttl = 180000;
      const error = new ElicitationTimeoutError(elicitId, ttl);

      expect(error.elicitId).toBe(elicitId);
      expect(error.ttl).toBe(ttl);
    });

    it('should handle various TTL values correctly', () => {
      const testCases = [
        { ttl: 1000, expectedSeconds: 1 },
        { ttl: 5000, expectedSeconds: 5 },
        { ttl: 30000, expectedSeconds: 30 },
        { ttl: 60000, expectedSeconds: 60 },
        { ttl: 300000, expectedSeconds: 300 },
      ];

      for (const { ttl, expectedSeconds } of testCases) {
        const error = new ElicitationTimeoutError('test', ttl);
        expect(error.getPublicMessage()).toContain(`${expectedSeconds} seconds`);
      }
    });
  });

  describe('Error Inheritance and Type Guards', () => {
    it('should maintain instanceof checks for ElicitationNotSupportedError', () => {
      const error = new ElicitationNotSupportedError();

      expect(error instanceof ElicitationNotSupportedError).toBe(true);
      expect(error instanceof PublicMcpError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should maintain instanceof checks for ElicitationTimeoutError', () => {
      const error = new ElicitationTimeoutError('test', 1000);

      expect(error instanceof ElicitationTimeoutError).toBe(true);
      expect(error instanceof PublicMcpError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should distinguish between error types', () => {
      const notSupportedError = new ElicitationNotSupportedError();
      const timeoutError = new ElicitationTimeoutError('test', 1000);

      expect(notSupportedError instanceof ElicitationTimeoutError).toBe(false);
      expect(timeoutError instanceof ElicitationNotSupportedError).toBe(false);
    });
  });

  describe('Error Messages', () => {
    it('should provide different messages for different elicitation failure scenarios', () => {
      const scenarios = [
        {
          error: new ElicitationNotSupportedError(),
          expectedContains: 'does not support elicitation',
        },
        {
          error: new ElicitationNotSupportedError('Client does not support form-based elicitation'),
          expectedContains: 'form-based elicitation',
        },
        {
          error: new ElicitationNotSupportedError('Client does not support URL-based elicitation'),
          expectedContains: 'URL-based elicitation',
        },
        {
          error: new ElicitationNotSupportedError('No session available for elicitation'),
          expectedContains: 'No session',
        },
        {
          error: new ElicitationNotSupportedError('Transport not available for elicitation'),
          expectedContains: 'Transport not available',
        },
      ];

      for (const { error, expectedContains } of scenarios) {
        expect(error.message).toContain(expectedContains);
      }
    });
  });
});
