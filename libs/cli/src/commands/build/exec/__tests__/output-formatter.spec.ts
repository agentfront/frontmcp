import {
  formatToolResult,
  formatResourceResult,
  formatPromptResult,
  formatSubscriptionEvent,
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

    it('should handle text block with undefined text (fallback to empty)', () => {
      const result = { content: [{ type: 'text' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toBe('');
    });

    it('should handle image block with no data', () => {
      const result = { content: [{ type: 'image', mimeType: 'image/png' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Image: image/png, 0 chars base64]');
    });

    it('should handle image block with no mimeType', () => {
      const result = { content: [{ type: 'image', data: 'abc' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Image: unknown');
    });

    it('should handle resource block with no uri', () => {
      const result = { content: [{ type: 'resource' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Resource: unknown]');
    });

    it('should handle audio block with no mimeType', () => {
      const result = { content: [{ type: 'audio' }] };
      const output = formatToolResult(result, 'text');
      expect(output).toContain('[Audio: unknown]');
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

  it('should JSON.stringify content block with no text, uri, or binary data', () => {
    const result = { contents: [{ type: 'custom', metadata: 'test' }] };
    const output = formatResourceResult(result, 'text');
    expect(output).toContain('"type"');
    expect(output).toContain('"custom"');
  });

  it('should fall through to JSON when data is present but mimeType is missing', () => {
    const result = { contents: [{ data: 'base64stuff' }] };
    const output = formatResourceResult(result, 'text');
    // Without both data AND mimeType, falls through to JSON.stringify
    expect(output).toContain('"data"');
    expect(output).toContain('"base64stuff"');
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

  it('should JSON.stringify content when text is missing', () => {
    const result = { messages: [{ role: 'user', content: { data: 'binary' } }] };
    const output = formatPromptResult(result, 'text');
    expect(output).toContain('[user]');
    expect(output).toContain('"data"');
    expect(output).toContain('"binary"');
  });

  it('should JSON.stringify content when content has no text property', () => {
    const result = { messages: [{ role: 'assistant', content: {} }] };
    const output = formatPromptResult(result, 'text');
    expect(output).toContain('[assistant]');
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

describe('formatSubscriptionEvent', () => {
  it('should return JSON in json mode', () => {
    const event = { type: 'resource_updated', uri: 'file://test.txt', timestamp: '2024-01-01T00:00:00Z' };
    const output = formatSubscriptionEvent(event, 'json');
    expect(JSON.parse(output)).toEqual(event);
  });

  it('should format resource_updated events in text mode', () => {
    const event = { type: 'resource_updated', uri: 'file://test.txt', timestamp: '2024-01-01T00:00:00Z' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toContain('Resource updated: file://test.txt');
    expect(output).toContain('[2024-01-01T00:00:00Z]');
  });

  it('should format notification events in text mode', () => {
    const event = { type: 'notification', method: 'resources/updated', params: { uri: 'test' }, timestamp: '2024-01-01T00:00:00Z' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toContain('Notification: resources/updated');
    expect(output).toContain('"uri":"test"');
  });

  it('should format notification without params', () => {
    const event = { type: 'notification', method: 'ping' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toBe('Notification: ping');
  });

  it('should handle unknown event types', () => {
    const event = { type: 'custom_event', data: 'test' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toContain('custom_event:');
  });

  it('should handle missing uri in resource_updated', () => {
    const event = { type: 'resource_updated' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toContain('Resource updated: unknown');
  });

  it('should handle missing timestamp', () => {
    const event = { type: 'resource_updated', uri: 'file://a.txt' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toBe('Resource updated: file://a.txt');
    expect(output).not.toContain('[');
  });

  it('should handle notification with missing method', () => {
    const event = { type: 'notification' };
    const output = formatSubscriptionEvent(event, 'text');
    expect(output).toContain('Notification: unknown');
  });
});

describe('generateOutputFormatterSource', () => {
  it('should return valid JavaScript source', () => {
    const source = generateOutputFormatterSource();
    expect(source).toContain('function formatToolResult');
    expect(source).toContain('function formatResourceResult');
    expect(source).toContain('function formatPromptResult');
    expect(source).toContain('function formatSubscriptionEvent');
    expect(source).toContain('module.exports');
  });

  it('should export formatSubscriptionEvent', () => {
    const source = generateOutputFormatterSource();
    expect(source).toContain('formatSubscriptionEvent');
  });

  it('should be evaluable JavaScript', () => {
    const source = generateOutputFormatterSource();
    // Should not throw when evaluated
    expect(() => {
      new Function(source);
    }).not.toThrow();
  });
});
