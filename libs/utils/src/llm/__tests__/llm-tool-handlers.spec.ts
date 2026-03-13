import { processPlatformToolCalls } from '../llm-tool-handlers';
import type { CallToolFn, OpenAIToolCallItem, ClaudeToolUseBlock, VercelToolCallInfo } from '../llm-tool-handler.types';

describe('processPlatformToolCalls', () => {
  let mockCallTool: jest.MockedFunction<CallToolFn>;

  beforeEach(() => {
    mockCallTool = jest.fn();
  });

  // ── OpenAI ──────────────────────────────────────────────────────────────

  describe('openai', () => {
    it('parses JSON arguments and returns tool responses', async () => {
      mockCallTool.mockResolvedValue('hello world');

      const calls: OpenAIToolCallItem[] = [
        { id: 'tc-1', type: 'function', function: { name: 'greet', arguments: '{"name":"World"}' } },
      ];

      const results = await processPlatformToolCalls('openai', calls, mockCallTool);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'hello world',
      });
      expect(mockCallTool).toHaveBeenCalledWith('greet', { name: 'World' });
    });

    it('returns error content for invalid JSON arguments', async () => {
      const calls: OpenAIToolCallItem[] = [
        { id: 'tc-2', type: 'function', function: { name: 'greet', arguments: 'not-json' } },
      ];

      const results = await processPlatformToolCalls('openai', calls, mockCallTool);

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('tool');
      expect(results[0].tool_call_id).toBe('tc-2');
      expect(results[0].content).toContain('Invalid JSON');
      expect(results[0].content).toContain('greet');
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it('stringifies non-string results', async () => {
      mockCallTool.mockResolvedValue({ data: 123 });

      const calls: OpenAIToolCallItem[] = [
        { id: 'tc-3', type: 'function', function: { name: 'fetch_data', arguments: '{}' } },
      ];

      const results = await processPlatformToolCalls('openai', calls, mockCallTool);

      expect(results[0].content).toBe(JSON.stringify({ data: 123 }));
    });

    it('passes string results directly', async () => {
      mockCallTool.mockResolvedValue('direct string');

      const calls: OpenAIToolCallItem[] = [
        { id: 'tc-4', type: 'function', function: { name: 'tool1', arguments: '{}' } },
      ];

      const results = await processPlatformToolCalls('openai', calls, mockCallTool);

      expect(results[0].content).toBe('direct string');
    });

    it('handles empty array of tool calls', async () => {
      const results = await processPlatformToolCalls('openai', [], mockCallTool);

      expect(results).toEqual([]);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it('processes multiple tool calls in parallel', async () => {
      mockCallTool.mockResolvedValueOnce('result-a').mockResolvedValueOnce('result-b');

      const calls: OpenAIToolCallItem[] = [
        { id: 'tc-a', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } },
        { id: 'tc-b', type: 'function', function: { name: 'tool_b', arguments: '{"y":2}' } },
      ];

      const results = await processPlatformToolCalls('openai', calls, mockCallTool);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ role: 'tool', tool_call_id: 'tc-a', content: 'result-a' });
      expect(results[1]).toEqual({ role: 'tool', tool_call_id: 'tc-b', content: 'result-b' });
    });
  });

  // ── Claude ──────────────────────────────────────────────────────────────

  describe('claude', () => {
    it('processes tool use blocks and returns result blocks', async () => {
      mockCallTool.mockResolvedValue('hello');

      const blocks: ClaudeToolUseBlock[] = [{ type: 'tool_use', id: 'tu-1', name: 'greet', input: { name: 'World' } }];

      const results = await processPlatformToolCalls('claude', blocks, mockCallTool);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'tu-1',
        content: 'hello',
      });
      expect(mockCallTool).toHaveBeenCalledWith('greet', { name: 'World' });
    });

    it('joins array text content with newlines', async () => {
      mockCallTool.mockResolvedValue([
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ]);

      const blocks: ClaudeToolUseBlock[] = [{ type: 'tool_use', id: 'tu-2', name: 'tool', input: {} }];

      const results = await processPlatformToolCalls('claude', blocks, mockCallTool);

      expect(results[0].content).toBe('line1\nline2');
    });

    it('returns string result directly', async () => {
      mockCallTool.mockResolvedValue('direct string');

      const blocks: ClaudeToolUseBlock[] = [{ type: 'tool_use', id: 'tu-3', name: 'tool', input: {} }];

      const results = await processPlatformToolCalls('claude', blocks, mockCallTool);

      expect(results[0].content).toBe('direct string');
    });

    it('stringifies object results', async () => {
      mockCallTool.mockResolvedValue({ data: 42 });

      const blocks: ClaudeToolUseBlock[] = [{ type: 'tool_use', id: 'tu-4', name: 'tool', input: {} }];

      const results = await processPlatformToolCalls('claude', blocks, mockCallTool);

      expect(results[0].content).toContain('42');
    });

    it('handles array items without text property', async () => {
      mockCallTool.mockResolvedValue([{ type: 'image', data: 'abc' }]);

      const blocks: ClaudeToolUseBlock[] = [{ type: 'tool_use', id: 'tu-5', name: 'tool', input: {} }];

      const results = await processPlatformToolCalls('claude', blocks, mockCallTool);

      expect(results[0].content).toBe('');
    });

    it('handles empty array of blocks', async () => {
      const results = await processPlatformToolCalls('claude', [], mockCallTool);

      expect(results).toEqual([]);
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  // ── Vercel AI ───────────────────────────────────────────────────────────

  describe('vercel-ai', () => {
    it('forwards tool call to callTool and returns result', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'done' }] };
      mockCallTool.mockResolvedValue(expectedResult);

      const info: VercelToolCallInfo = {
        toolCallId: 'vc-1',
        toolName: 'greet',
        args: { name: 'World' },
      };

      const result = await processPlatformToolCalls('vercel-ai', info, mockCallTool);

      expect(result).toBe(expectedResult);
      expect(mockCallTool).toHaveBeenCalledWith('greet', { name: 'World' });
    });

    it('passes through any result type', async () => {
      mockCallTool.mockResolvedValue(42);

      const info: VercelToolCallInfo = {
        toolCallId: 'vc-2',
        toolName: 'count',
        args: {},
      };

      const result = await processPlatformToolCalls('vercel-ai', info, mockCallTool);

      expect(result).toBe(42);
    });
  });

  // ── Unsupported platform ───────────────────────────────────────────────

  describe('unsupported platform', () => {
    it('throws for unknown platform', async () => {
      await expect(processPlatformToolCalls('unknown' as 'openai', [] as never, mockCallTool)).rejects.toThrow(
        'Unsupported platform: unknown',
      );
    });
  });
});
