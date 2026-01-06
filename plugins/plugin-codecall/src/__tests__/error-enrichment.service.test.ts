// file: plugins/plugin-codecall/src/__tests__/error-enrichment.service.test.ts

import { ErrorEnrichmentService, ERROR_CATEGORIES, EnrichedError } from '../services/error-enrichment.service';

describe('ErrorEnrichmentService', () => {
  let service: ErrorEnrichmentService;

  beforeEach(() => {
    service = new ErrorEnrichmentService();
  });

  describe('enrich()', () => {
    describe('syntax errors', () => {
      it('should identify SyntaxError', () => {
        const result = service.enrich(new SyntaxError('Unexpected token )'));
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
        expect(result.recoverable).toBe(true);
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      it('should identify "Unexpected token" in message', () => {
        const result = service.enrich('Unexpected token at position 5');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
      });

      it('should identify "Unexpected identifier" in message', () => {
        const result = service.enrich('Unexpected identifier');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
      });

      it('should identify "missing )" in message', () => {
        const result = service.enrich('Error: missing )');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
      });

      it('should identify "missing }" in message', () => {
        const result = service.enrich('Error: missing }');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
      });

      it('should identify "Unterminated string" in message', () => {
        const result = service.enrich('Unterminated string literal');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
        expect(result.suggestions).toContain('Check that all strings are closed with matching quotes');
      });

      it('should identify "Invalid or unexpected token"', () => {
        const result = service.enrich('Invalid or unexpected token');
        expect(result.category).toBe(ERROR_CATEGORIES.SYNTAX);
      });
    });

    describe('security errors', () => {
      it('should identify eval-related errors', () => {
        const result = service.enrich('eval is not allowed');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
        expect(result.docs).toContain('codecall/security');
        expect(result.recoverable).toBe(true);
      });

      it('should identify "Function constructor" errors', () => {
        const result = service.enrich('Function constructor is blocked');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
      });

      it('should identify "dangerous pattern" errors', () => {
        const result = service.enrich('dangerous pattern detected');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
      });

      it('should identify "blocked" errors', () => {
        const result = service.enrich('This operation is blocked');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
      });

      it('should identify "forbidden" errors', () => {
        const result = service.enrich('forbidden operation attempted');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
      });

      it('should identify self-reference errors', () => {
        const result = service.enrich('self-reference detected');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
        expect(result.recoverable).toBe(false);
      });

      it('should identify codecall: reference errors', () => {
        const result = service.enrich('Cannot call codecall:search from script');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
        expect(result.recoverable).toBe(false);
      });
    });

    describe('timeout errors', () => {
      it('should identify "timeout" errors', () => {
        const result = service.enrich('Operation timeout');
        expect(result.category).toBe(ERROR_CATEGORIES.TIMEOUT);
        expect(result.recoverable).toBe(true);
      });

      it('should identify "timed out" errors', () => {
        const result = service.enrich('Script execution timed out');
        expect(result.category).toBe(ERROR_CATEGORIES.TIMEOUT);
      });

      it('should identify "exceeded time" errors', () => {
        const result = service.enrich('Script exceeded time limit');
        expect(result.category).toBe(ERROR_CATEGORIES.TIMEOUT);
      });
    });

    describe('tool not found errors', () => {
      it('should identify "tool not found" errors', () => {
        const result = service.enrich('tool "foo" not found');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_NOT_FOUND);
        expect(result.recoverable).toBe(true);
        expect(result.example).toBeDefined();
      });

      it('should identify "unknown tool" errors', () => {
        const result = service.enrich('unknown tool specified');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_NOT_FOUND);
      });

      it('should identify "no such tool" errors', () => {
        const result = service.enrich('no such tool exists');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_NOT_FOUND);
      });
    });

    describe('tool access denied errors', () => {
      it('should identify "access denied" errors', () => {
        const result = service.enrich('access denied for this tool');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_ACCESS_DENIED);
        expect(result.recoverable).toBe(false);
      });

      it('should identify "permission denied" errors', () => {
        const result = service.enrich('permission denied');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_ACCESS_DENIED);
      });

      it('should identify "not authorized" errors', () => {
        const result = service.enrich('You are not authorized');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_ACCESS_DENIED);
      });

      it('should identify "forbidden" access errors', () => {
        const result = service.enrich('Access forbidden');
        expect(result.category).toBe(ERROR_CATEGORIES.SECURITY); // matches security first
      });
    });

    describe('tool validation errors', () => {
      it('should identify "validation" errors', () => {
        const result = service.enrich('validation failed for input');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_VALIDATION);
        expect(result.recoverable).toBe(true);
        expect(result.example).toBeDefined();
      });

      it('should identify "invalid input" errors', () => {
        const result = service.enrich('invalid input provided');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_VALIDATION);
      });

      it('should identify "required missing" errors', () => {
        const result = service.enrich('required field is missing');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_VALIDATION);
      });

      it('should identify "type expected" errors', () => {
        const result = service.enrich('string type expected but got number');
        expect(result.category).toBe(ERROR_CATEGORIES.TOOL_VALIDATION);
      });
    });

    describe('runtime errors', () => {
      it('should identify TypeError', () => {
        const result = service.enrich(new TypeError('Cannot read property x'));
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
        expect(result.recoverable).toBe(true);
        expect(result.example).toBeDefined();
      });

      it('should identify ReferenceError', () => {
        const result = service.enrich(new ReferenceError('x is not defined'));
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify "is not defined" errors', () => {
        const result = service.enrich('variable foo is not defined');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify "is not a function" errors', () => {
        const result = service.enrich('x is not a function');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify "cannot read property" errors', () => {
        const result = service.enrich('Cannot read property of undefined');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify stack overflow errors', () => {
        const result = service.enrich('Maximum call stack size exceeded');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify "stack overflow" errors', () => {
        const result = service.enrich('stack overflow detected');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });

      it('should identify "too much recursion" errors', () => {
        const result = service.enrich('too much recursion');
        expect(result.category).toBe(ERROR_CATEGORIES.RUNTIME);
      });
    });

    describe('unknown errors', () => {
      it('should fallback to UNKNOWN for unrecognized errors', () => {
        const result = service.enrich('some random error message');
        expect(result.category).toBe(ERROR_CATEGORIES.UNKNOWN);
        expect(result.recoverable).toBe(true);
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      it('should handle null error', () => {
        const result = service.enrich(null);
        expect(result.category).toBe(ERROR_CATEGORIES.UNKNOWN);
        expect(result.message).toBe('An unknown error occurred');
      });

      it('should handle undefined error', () => {
        const result = service.enrich(undefined);
        expect(result.category).toBe(ERROR_CATEGORIES.UNKNOWN);
        expect(result.message).toBe('An unknown error occurred');
      });

      it('should handle object with message property', () => {
        const result = service.enrich({ message: 'custom error message' });
        expect(result.message).toContain('custom error message');
      });
    });

    describe('error code extraction', () => {
      it('should extract error code from Error with code property', () => {
        const error = new Error('Some error');
        (error as any).code = 'ERR_001';
        const result = service.enrich(error);
        expect(result.code).toBe('ERR_001');
      });

      it('should extract error code from object with code property', () => {
        const result = service.enrich({ message: 'error', code: 'ERR_002' });
        expect(result.code).toBe('ERR_002');
      });

      it('should return undefined code when not present', () => {
        const result = service.enrich('simple error');
        expect(result.code).toBeUndefined();
      });
    });

    describe('context handling', () => {
      it('should contextualize suggestions with toolName', () => {
        const result = service.enrich('tool not found', { toolName: 'myTool' });
        const hasContextualizedSuggestion = result.suggestions.some((s) => s.includes('"myTool"'));
        expect(hasContextualizedSuggestion).toBe(true);
      });

      it('should work without context', () => {
        const result = service.enrich('tool not found');
        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      it('should work with empty context', () => {
        const result = service.enrich('tool not found', {});
        expect(result.suggestions.length).toBeGreaterThan(0);
      });
    });

    describe('message formatting', () => {
      it('should remove file paths from messages', () => {
        const result = service.enrich('Error at /home/user/project/file.ts');
        expect(result.message).not.toContain('/home/user');
      });

      it('should remove Windows file paths from messages', () => {
        const result = service.enrich('Error at C:\\Users\\project\\file.ts');
        expect(result.message).not.toContain('C:\\Users');
      });

      it('should remove line numbers from messages', () => {
        const result = service.enrich('Error at position:10:20');
        expect(result.message).not.toContain(':10:20');
      });

      it('should remove stack traces from messages', () => {
        const result = service.enrich('Error\n    at function (file.js:1:1)\n    at other (file.js:2:2)');
        expect(result.message).not.toContain('at function');
        expect(result.message).not.toContain('at other');
      });

      it('should truncate very long messages', () => {
        const longMessage = 'x'.repeat(300);
        const result = service.enrich(longMessage);
        expect(result.message.length).toBeLessThanOrEqual(210); // 200 + "..." + potential prefix
      });

      it('should add prefix for very short generic messages', () => {
        const result = service.enrich(new SyntaxError('oops'));
        expect(result.message.length).toBeGreaterThan(4);
      });
    });
  });

  describe('enrichToolError()', () => {
    it('should handle NOT_FOUND error code', () => {
      const result = service.enrichToolError('myTool', 'NOT_FOUND');
      expect(result.category).toBe(ERROR_CATEGORIES.TOOL_NOT_FOUND);
      expect(result.message).toContain('myTool');
      expect(result.message).toContain('not found');
      expect(result.recoverable).toBe(true);
    });

    it('should handle ACCESS_DENIED error code', () => {
      const result = service.enrichToolError('myTool', 'ACCESS_DENIED');
      expect(result.category).toBe(ERROR_CATEGORIES.TOOL_ACCESS_DENIED);
      expect(result.message).toContain('Access denied');
      expect(result.recoverable).toBe(false);
    });

    it('should handle VALIDATION error code', () => {
      const result = service.enrichToolError('myTool', 'VALIDATION');
      expect(result.category).toBe(ERROR_CATEGORIES.TOOL_VALIDATION);
      expect(result.message).toContain('validation failed');
      expect(result.example).toBeDefined();
      expect(result.example).toContain('myTool');
      expect(result.recoverable).toBe(true);
    });

    it('should handle TIMEOUT error code', () => {
      const result = service.enrichToolError('myTool', 'TIMEOUT');
      expect(result.category).toBe(ERROR_CATEGORIES.TIMEOUT);
      expect(result.message).toContain('timed out');
      expect(result.recoverable).toBe(true);
    });

    it('should handle SELF_REFERENCE error code', () => {
      const result = service.enrichToolError('codecall:search', 'SELF_REFERENCE');
      expect(result.category).toBe(ERROR_CATEGORIES.SECURITY);
      expect(result.message).toContain('Cannot call CodeCall tool');
      expect(result.recoverable).toBe(false);
    });

    it('should handle unknown error codes', () => {
      const result = service.enrichToolError('myTool', 'UNKNOWN_CODE');
      expect(result.category).toBe(ERROR_CATEGORIES.TOOL_EXECUTION);
      expect(result.message).toContain('execution failed');
      expect(result.recoverable).toBe(true);
    });
  });

  describe('summarize()', () => {
    it('should return formatted summary for syntax errors', () => {
      const result = service.summarize(new SyntaxError('Unexpected token'));
      expect(result).toContain('[syntax]');
    });

    it('should return formatted summary for security errors', () => {
      const result = service.summarize('eval is forbidden');
      expect(result).toContain('[security]');
    });

    it('should return formatted summary for unknown errors', () => {
      const result = service.summarize('random error');
      expect(result).toContain('[unknown]');
    });
  });
});
