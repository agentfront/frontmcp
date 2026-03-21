import {
  McpAssertions,
  containsTool,
  containsResource,
  containsResourceTemplate,
  containsPrompt,
  isSuccessful,
  isError,
  hasTextContent,
  hasMimeType,
} from '../mcp-assertions';

describe('McpAssertions', () => {
  describe('assertSuccess', () => {
    it('should return data when response is successful', () => {
      const response = { success: true, data: { tools: [] }, durationMs: 10, requestId: 1 };
      const result = McpAssertions.assertSuccess(response);
      expect(result).toEqual({ tools: [] });
    });

    it('should throw when response is not successful', () => {
      const response = {
        success: false,
        error: { code: -32600, message: 'Invalid Request' },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertSuccess(response)).toThrow(/Expected success but got error.*Invalid Request/);
    });

    it('should throw with custom message when provided', () => {
      const response = {
        success: false,
        error: { code: -1, message: 'fail' },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertSuccess(response, 'custom msg')).toThrow('custom msg');
    });

    it('should throw when success is true but data is undefined', () => {
      const response = { success: true, data: undefined, durationMs: 10, requestId: 1 };
      expect(() => McpAssertions.assertSuccess(response)).toThrow(/Expected data but got undefined/);
    });

    it('should throw with custom message when data is undefined', () => {
      const response = { success: true, data: undefined, durationMs: 10, requestId: 1 };
      expect(() => McpAssertions.assertSuccess(response, 'no data')).toThrow('no data');
    });

    it('should handle response with error but no message gracefully', () => {
      const response = {
        success: false,
        error: undefined,
        durationMs: 10,
        requestId: 1,
      } as any;
      expect(() => McpAssertions.assertSuccess(response)).toThrow(/Unknown error/);
    });
  });

  describe('assertError', () => {
    it('should return error info when response is an error', () => {
      const response = {
        success: false,
        error: { code: -32600, message: 'Invalid' },
        durationMs: 10,
        requestId: 1,
      };
      const err = McpAssertions.assertError(response);
      expect(err).toEqual({ code: -32600, message: 'Invalid' });
    });

    it('should throw when response is successful', () => {
      const response = { success: true, data: {}, durationMs: 10, requestId: 1 };
      expect(() => McpAssertions.assertError(response)).toThrow('Expected error but got success');
    });

    it('should throw when error info is undefined', () => {
      const response = { success: false, error: undefined, durationMs: 10, requestId: 1 } as any;
      expect(() => McpAssertions.assertError(response)).toThrow('Expected error info but got undefined');
    });

    it('should validate expected error code', () => {
      const response = {
        success: false,
        error: { code: -32600, message: 'bad' },
        durationMs: 10,
        requestId: 1,
      };
      const err = McpAssertions.assertError(response, -32600);
      expect(err.code).toBe(-32600);
    });

    it('should throw when error code does not match expected', () => {
      const response = {
        success: false,
        error: { code: -32600, message: 'bad' },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertError(response, -32602)).toThrow(/Expected error code -32602 but got -32600/);
    });
  });

  describe('assertToolSuccess', () => {
    it('should pass for ToolResultWrapper with isError false', () => {
      const wrapper = { raw: { content: [] }, isError: false, isSuccess: true } as any;
      expect(() => McpAssertions.assertToolSuccess(wrapper)).not.toThrow();
    });

    it('should throw for ToolResultWrapper with isError true', () => {
      const wrapper = { raw: { content: [] }, isError: true, error: { message: 'tool failed' } } as any;
      expect(() => McpAssertions.assertToolSuccess(wrapper)).toThrow('Tool call failed: tool failed');
    });

    it('should pass for McpResponse with success true and no isError', () => {
      const response = { success: true, data: { content: [], isError: false }, durationMs: 10, requestId: 1 };
      expect(() => McpAssertions.assertToolSuccess(response)).not.toThrow();
    });

    it('should throw for McpResponse with success false', () => {
      const response = {
        success: false,
        error: { message: 'rpc error', code: -1 },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertToolSuccess(response)).toThrow('Tool call failed: rpc error');
    });

    it('should throw for McpResponse where data.isError is true', () => {
      const response = { success: true, data: { content: [], isError: true }, durationMs: 10, requestId: 1 };
      expect(() => McpAssertions.assertToolSuccess(response)).toThrow('Tool returned isError=true');
    });
  });

  describe('assertToolContent', () => {
    it('should pass when ToolResultWrapper has matching content type', () => {
      const wrapper = { raw: { content: [{ type: 'text', text: 'hello' }] } } as any;
      expect(() => McpAssertions.assertToolContent(wrapper, 'text')).not.toThrow();
    });

    it('should throw when ToolResultWrapper lacks matching content type', () => {
      const wrapper = { raw: { content: [{ type: 'image', data: '', mimeType: '' }] } } as any;
      expect(() => McpAssertions.assertToolContent(wrapper, 'text')).toThrow(
        'Expected tool result to have text content',
      );
    });

    it('should pass when McpResponse has matching content type', () => {
      const response = {
        success: true,
        data: { content: [{ type: 'image', data: '', mimeType: '' }] },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertToolContent(response, 'image')).not.toThrow();
    });

    it('should throw when McpResponse is not successful', () => {
      const response = {
        success: false,
        error: { code: -1, message: 'err' },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertToolContent(response, 'text')).toThrow('Tool call was not successful');
    });
  });

  describe('assertTextResource', () => {
    it('should return text from ResourceContentWrapper', () => {
      const wrapper = {
        raw: { contents: [] },
        isError: false,
        text: () => 'resource text',
      } as any;
      const text = McpAssertions.assertTextResource(wrapper);
      expect(text).toBe('resource text');
    });

    it('should throw when ResourceContentWrapper has isError true', () => {
      const wrapper = {
        raw: { contents: [] },
        isError: true,
        error: { message: 'read fail' },
        text: () => undefined,
      } as any;
      expect(() => McpAssertions.assertTextResource(wrapper)).toThrow('Resource read failed: read fail');
    });

    it('should throw when ResourceContentWrapper text is undefined', () => {
      const wrapper = {
        raw: { contents: [] },
        isError: false,
        text: () => undefined,
      } as any;
      expect(() => McpAssertions.assertTextResource(wrapper)).toThrow('Expected text content but got undefined');
    });

    it('should return text from McpResponse', () => {
      const response = {
        success: true,
        data: { contents: [{ uri: 'file://a', text: 'file content' }] },
        durationMs: 10,
        requestId: 1,
      };
      const text = McpAssertions.assertTextResource(response);
      expect(text).toBe('file content');
    });

    it('should throw when McpResponse is not successful', () => {
      const response = {
        success: false,
        error: { code: -1, message: 'not found' },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertTextResource(response)).toThrow('Resource read failed: not found');
    });

    it('should throw when McpResponse contents has no text field', () => {
      const response = {
        success: true,
        data: { contents: [{ uri: 'file://a', blob: 'base64data' }] },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertTextResource(response)).toThrow('Expected text content but got undefined');
    });

    it('should throw when McpResponse contents is empty', () => {
      const response = {
        success: true,
        data: { contents: [] },
        durationMs: 10,
        requestId: 1,
      };
      expect(() => McpAssertions.assertTextResource(response)).toThrow('Expected text content but got undefined');
    });
  });

  describe('assertContainsTool', () => {
    it('should return the tool when found', () => {
      const tools = [
        { name: 'tool-a', description: 'A' },
        { name: 'tool-b', description: 'B' },
      ] as any[];
      const tool = McpAssertions.assertContainsTool(tools, 'tool-b');
      expect(tool.name).toBe('tool-b');
    });

    it('should throw when tool is not found', () => {
      const tools = [{ name: 'tool-a' }] as any[];
      expect(() => McpAssertions.assertContainsTool(tools, 'missing')).toThrow(/Expected to find tool "missing"/);
    });
  });

  describe('assertContainsResource', () => {
    it('should return the resource when found', () => {
      const resources = [{ uri: 'file://a' }, { uri: 'file://b' }] as any[];
      const resource = McpAssertions.assertContainsResource(resources, 'file://b');
      expect(resource.uri).toBe('file://b');
    });

    it('should throw when resource is not found', () => {
      const resources = [{ uri: 'file://a' }] as any[];
      expect(() => McpAssertions.assertContainsResource(resources, 'file://missing')).toThrow(
        /Expected to find resource "file:\/\/missing"/,
      );
    });
  });

  describe('assertContainsResourceTemplate', () => {
    it('should return the template when found', () => {
      const templates = [{ uriTemplate: 'file://{id}' }] as any[];
      const t = McpAssertions.assertContainsResourceTemplate(templates, 'file://{id}');
      expect(t.uriTemplate).toBe('file://{id}');
    });

    it('should throw when template is not found', () => {
      const templates = [] as any[];
      expect(() => McpAssertions.assertContainsResourceTemplate(templates, 'missing://{x}')).toThrow(
        /Expected to find resource template/,
      );
    });
  });

  describe('assertContainsPrompt', () => {
    it('should return the prompt when found', () => {
      const prompts = [{ name: 'greeting' }, { name: 'farewell' }] as any[];
      const p = McpAssertions.assertContainsPrompt(prompts, 'farewell');
      expect(p.name).toBe('farewell');
    });

    it('should throw when prompt is not found', () => {
      const prompts = [{ name: 'greeting' }] as any[];
      expect(() => McpAssertions.assertContainsPrompt(prompts, 'missing')).toThrow(/Expected to find prompt "missing"/);
    });
  });
});

describe('helper functions', () => {
  describe('containsTool', () => {
    it('should return true when tool exists', () => {
      expect(containsTool([{ name: 'a' }] as any[], 'a')).toBe(true);
    });

    it('should return false when tool does not exist', () => {
      expect(containsTool([{ name: 'a' }] as any[], 'b')).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(containsTool([], 'a')).toBe(false);
    });
  });

  describe('containsResource', () => {
    it('should return true when resource exists', () => {
      expect(containsResource([{ uri: 'file://a' }] as any[], 'file://a')).toBe(true);
    });

    it('should return false when resource does not exist', () => {
      expect(containsResource([{ uri: 'file://a' }] as any[], 'file://b')).toBe(false);
    });
  });

  describe('containsResourceTemplate', () => {
    it('should return true when template exists', () => {
      expect(containsResourceTemplate([{ uriTemplate: 'file://{id}' }] as any[], 'file://{id}')).toBe(true);
    });

    it('should return false when template does not exist', () => {
      expect(containsResourceTemplate([], 'missing')).toBe(false);
    });
  });

  describe('containsPrompt', () => {
    it('should return true when prompt exists', () => {
      expect(containsPrompt([{ name: 'greeting' }] as any[], 'greeting')).toBe(true);
    });

    it('should return false when prompt does not exist', () => {
      expect(containsPrompt([{ name: 'greeting' }] as any[], 'missing')).toBe(false);
    });
  });

  describe('isSuccessful', () => {
    it('should return true when isSuccess is true', () => {
      const wrapper = { isSuccess: true, isError: false } as any;
      expect(isSuccessful(wrapper)).toBe(true);
    });

    it('should return false when isSuccess is false', () => {
      const wrapper = { isSuccess: false, isError: true } as any;
      expect(isSuccessful(wrapper)).toBe(false);
    });
  });

  describe('isError', () => {
    it('should return true when isError is true', () => {
      const wrapper = { isSuccess: false, isError: true, error: { code: -1, message: 'x' } } as any;
      expect(isError(wrapper)).toBe(true);
    });

    it('should return false when isError is false', () => {
      const wrapper = { isSuccess: true, isError: false } as any;
      expect(isError(wrapper)).toBe(false);
    });

    it('should check error code when expectedCode is provided', () => {
      const wrapper = { isSuccess: false, isError: true, error: { code: -32600, message: 'bad' } } as any;
      expect(isError(wrapper, -32600)).toBe(true);
      expect(isError(wrapper, -32602)).toBe(false);
    });

    it('should return false when isError false even with expectedCode', () => {
      const wrapper = { isSuccess: true, isError: false } as any;
      expect(isError(wrapper, -32600)).toBe(false);
    });
  });

  describe('hasTextContent', () => {
    it('should return true when wrapper has text content', () => {
      const wrapper = { hasTextContent: () => true } as any;
      expect(hasTextContent(wrapper)).toBe(true);
    });

    it('should return false when wrapper has no text content', () => {
      const wrapper = { hasTextContent: () => false } as any;
      expect(hasTextContent(wrapper)).toBe(false);
    });
  });

  describe('hasMimeType', () => {
    it('should return true when MIME type matches', () => {
      const wrapper = { hasMimeType: (t: string) => t === 'application/json' } as any;
      expect(hasMimeType(wrapper, 'application/json')).toBe(true);
    });

    it('should return false when MIME type does not match', () => {
      const wrapper = { hasMimeType: (t: string) => t === 'application/json' } as any;
      expect(hasMimeType(wrapper, 'text/plain')).toBe(false);
    });
  });
});
