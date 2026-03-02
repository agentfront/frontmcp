import {
  formatToolResult,
  formatResourceResult,
  formatPromptResult,
  generateOutputFormatterSource,
} from '../cli-runtime/output-formatter';

describe('formatToolResult', () => {
  describe('json mode', () => {
    it('should return JSON stringified result', () => {
      const result = { content: [{ type: 'text', text: 'hello' }] };
      const output = formatToolResult(result, 'json');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('should pretty-print with 2-space indent', () => {
      const result = { content: [{ type: 'text', text: 'hello' }] };
      const output = formatToolResult(result, 'json');
      expect(output).toContain('\n  ');
    });
  });

  describe('text mode', () => {
    it('should extract text content blocks', () => {
      const result = {
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
      };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('Line 1\nLine 2');
    });

    it('should handle image content with placeholder', () => {
      const result = {
        content: [{ type: 'image', mimeType: 'image/png', data: 'base64data' }],
      };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Image: image/png');
    });

    it('should handle resource content with placeholder', () => {
      const result = {
        content: [{ type: 'resource', uri: 'file://test.txt' }],
      };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Resource: file://test.txt]');
    });

    it('should handle audio content with placeholder', () => {
      const result = {
        content: [{ type: 'audio', mimeType: 'audio/mp3' }],
      };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Audio: audio/mp3]');
    });

    it('should handle unknown content types', () => {
      const result = {
        content: [{ type: 'custom', data: 'something' }],
      };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[custom:');
    });

    it('should prefix with Error: when isError is true', () => {
      const result = {
        content: [{ type: 'text', text: 'Something went wrong' }],
        isError: true,
      };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('Error: Something went wrong');
    });

    it('should handle empty content array', () => {
      const result = { content: [] };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('(no output)');
    });

    it('should handle empty content with isError', () => {
      const result = { content: [], isError: true };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('(error: no content)');
    });

    it('should handle missing content', () => {
      const result = {};
      const output = formatToolResult(result, 'text');
      expect(output).toBe('(no output)');
    });

    it('should handle text block with empty text', () => {
      const result = { content: [{ type: 'text', text: '' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('');
    });
  });
});

describe('formatResourceResult', () => {
  it('should return JSON in json mode', () => {
    const result = { contents: [{ text: 'data' }] };
    const output = formatResourceResult(result, 'json');
    expect(JSON.parse(output)).toEqual(result);
  });

  it('should extract text content in text mode', () => {
    const result = { contents: [{ text: 'file content here' }] };
    const output = formatResourceResult(result, 'text');
    expect(output).toBe('file content here');
  });

  it('should show URI for resource entries', () => {
    const result = { contents: [{ uri: 'file://data.txt' }] };
    const output = formatResourceResult(result, 'text');
    expect(output).toContain('[Resource: file://data.txt]');
  });

  it('should show binary descriptor for binary entries', () => {
    const result = { contents: [{ data: 'abc123', mimeType: 'application/octet-stream' }] };
    const output = formatResourceResult(result, 'text');
    expect(output).toContain('[Binary: application/octet-stream');
  });

  it('should handle empty contents', () => {
    const result = { contents: [] };
    const output = formatResourceResult(result, 'text');
    expect(output).toBe('(empty resource)');
  });

  it('should handle missing contents', () => {
    const result = {};
    const output = formatResourceResult(result, 'text');
    expect(output).toBe('(empty resource)');
  });
});

describe('formatPromptResult', () => {
  it('should return JSON in json mode', () => {
    const result = { messages: [{ role: 'user', content: { text: 'hi' } }] };
    const output = formatPromptResult(result, 'json');
    expect(JSON.parse(output)).toEqual(result);
  });

  it('should format messages with role prefix in text mode', () => {
    const result = {
      messages: [
        { role: 'user', content: { text: 'Hello' } },
        { role: 'assistant', content: { text: 'Hi there' } },
      ],
    };
    const output = formatPromptResult(result, 'text');
    expect(output).toContain('[user] Hello');
    expect(output).toContain('[assistant] Hi there');
  });

  it('should use unknown role when missing', () => {
    const result = { messages: [{ content: { text: 'test' } }] };
    const output = formatPromptResult(result, 'text');
    expect(output).toContain('[unknown] test');
  });

  it('should handle empty messages', () => {
    const result = { messages: [] };
    const output = formatPromptResult(result, 'text');
    expect(output).toBe('(empty prompt)');
  });

  it('should handle missing messages', () => {
    const result = {};
    const output = formatPromptResult(result, 'text');
    expect(output).toBe('(empty prompt)');
  });
});

describe('generateOutputFormatterSource', () => {
  it('should return valid JavaScript source', () => {
    const source = generateOutputFormatterSource();
    expect(source).toContain('function formatToolResult');
    expect(source).toContain('function formatResourceResult');
    expect(source).toContain('function formatPromptResult');
    expect(source).toContain('module.exports');
  });

  it('should be evaluable JavaScript', () => {
    const source = generateOutputFormatterSource();
    // Should not throw when evaluated
    expect(() => {
      new Function(source);
    }).not.toThrow();
  });
});
