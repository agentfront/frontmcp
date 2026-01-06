// file: libs/plugins/src/codecall/__tests__/mcp-result.test.ts

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { extractResultFromCallToolResult } from '../utils';

describe('extractResultFromCallToolResult', () => {
  describe('Error Cases (isError=true)', () => {
    it('should throw Error with text content message', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: 'Database connection failed' }],
        isError: true,
      };

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('Database connection failed');
    });

    it('should throw Error with exact message from text content', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: 'Validation error: email is required' }],
        isError: true,
      };

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('Validation error: email is required');
    });

    it('should throw generic error when no text content', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
        isError: true,
      };

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('Tool execution failed');
    });

    it('should throw generic error when content is empty array', () => {
      const mcpResult: CallToolResult = {
        content: [],
        isError: true,
      };

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('Tool execution failed');
    });

    it('should throw generic error when content is undefined', () => {
      const mcpResult: CallToolResult = {
        isError: true,
      } as any;

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('Tool execution failed');
    });

    it('should use first text content when multiple items present', () => {
      const mcpResult: CallToolResult = {
        content: [
          { type: 'text', text: 'First error message' },
          { type: 'text', text: 'Second error message' },
        ],
        isError: true,
      };

      expect(() => extractResultFromCallToolResult(mcpResult)).toThrow('First error message');
    });
  });

  describe('Success Cases', () => {
    it('should return undefined for empty content array', () => {
      const mcpResult: CallToolResult = {
        content: [],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBeUndefined();
    });

    it('should return undefined for null/undefined content', () => {
      const mcpResult: CallToolResult = {
        isError: false,
      } as any;

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBeUndefined();
    });

    it('should parse single JSON text content and return object', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{"id": "123", "name": "Alice"}' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({ id: '123', name: 'Alice' });
    });

    it('should parse JSON array from text content', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '[1, 2, 3, 4, 5]' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse nested JSON structure', () => {
      const mcpResult: CallToolResult = {
        content: [
          {
            type: 'text',
            text: '{"user": {"id": "1", "profile": {"name": "Bob", "age": 30}}}',
          },
        ],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({
        user: { id: '1', profile: { name: 'Bob', age: 30 } },
      });
    });

    it('should return raw text when JSON parse fails', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: 'Hello, this is plain text' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe('Hello, this is plain text');
    });

    it('should return raw text for invalid JSON', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{invalid json}' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe('{invalid json}');
    });

    it('should return raw text for partial JSON', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{"incomplete": ' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe('{"incomplete": ');
    });

    it('should return content array for multiple text items', () => {
      const mcpResult: CallToolResult = {
        content: [
          { type: 'text', text: 'First item' },
          { type: 'text', text: 'Second item' },
        ],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([
        { type: 'text', text: 'First item' },
        { type: 'text', text: 'Second item' },
      ]);
    });

    it('should return content array for image content', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([{ type: 'image', data: 'base64imagedata', mimeType: 'image/png' }]);
    });

    it('should return content array for mixed content types', () => {
      const mcpResult: CallToolResult = {
        content: [
          { type: 'text', text: 'Description' },
          { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
        ],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([
        { type: 'text', text: 'Description' },
        { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
      ]);
    });

    it('should return content array for resource content', () => {
      const mcpResult: CallToolResult = {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///path/to/file.txt',
              mimeType: 'text/plain',
              text: 'File content',
            },
          },
        ],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([
        {
          type: 'resource',
          resource: {
            uri: 'file:///path/to/file.txt',
            mimeType: 'text/plain',
            text: 'File content',
          },
        },
      ]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty JSON object', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{}' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({});
    });

    it('should handle empty JSON array', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '[]' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual([]);
    });

    it('should handle JSON null', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: 'null' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe(null);
    });

    it('should handle JSON boolean true', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: 'true' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe(true);
    });

    it('should handle JSON number', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '42.5' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe(42.5);
    });

    it('should handle JSON string', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '"hello world"' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toBe('hello world');
    });

    it('should handle empty text string', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      // Empty string is not valid JSON, so it returns raw text
      expect(result).toBe('');
    });

    it('should handle whitespace-only text', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '   \n\t  ' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      // Whitespace is not valid JSON, so it returns raw text
      expect(result).toBe('   \n\t  ');
    });

    it('should handle very large JSON', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify(largeArray) }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual(largeArray);
      expect((result as unknown[]).length).toBe(1000);
    });

    it('should handle JSON with special characters', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{"emoji": "🚀", "unicode": "日本語", "escape": "line1\\nline2"}' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({
        emoji: '🚀',
        unicode: '日本語',
        escape: 'line1\nline2',
      });
    });

    it('should handle isError=false explicitly', () => {
      const mcpResult: CallToolResult = {
        content: [{ type: 'text', text: '{"success": true}' }],
        isError: false,
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({ success: true });
    });

    it('should handle missing isError property (defaults to false)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mcpResult: any = {
        content: [{ type: 'text', text: '{"data": "test"}' }],
      };

      const result = extractResultFromCallToolResult(mcpResult);

      expect(result).toEqual({ data: 'test' });
    });
  });
});
