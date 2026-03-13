import { createToolCallHandler } from '../createToolHandler';
import type { DirectMcpServer } from '@frontmcp/sdk';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFormatResultForPlatform = jest.fn();

jest.mock('@frontmcp/sdk', () => ({
  formatResultForPlatform: (...args: unknown[]) => mockFormatResultForPlatform(...args),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createToolCallHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('callTool calls server.callTool and formats result', async () => {
    const rawResult = { content: [{ type: 'text', text: 'hello' }] };
    const formattedResult = 'hello';
    const mockCallTool = jest.fn().mockResolvedValue(rawResult);
    mockFormatResultForPlatform.mockReturnValue(formattedResult);

    const server = { callTool: mockCallTool } as unknown as DirectMcpServer;
    const handler = createToolCallHandler(server, 'openai');

    const result = await handler.callTool('my_tool', { key: 'value' });

    expect(mockCallTool).toHaveBeenCalledWith('my_tool', { key: 'value' });
    expect(mockFormatResultForPlatform).toHaveBeenCalledWith(rawResult, 'openai');
    expect(result).toBe(formattedResult);
  });

  it('passes args correctly to server.callTool', async () => {
    const rawResult = { content: [] };
    const mockCallTool = jest.fn().mockResolvedValue(rawResult);
    mockFormatResultForPlatform.mockReturnValue(null);

    const server = { callTool: mockCallTool } as unknown as DirectMcpServer;
    const handler = createToolCallHandler(server, 'claude');

    await handler.callTool('navigate', { path: '/dashboard', replace: true });

    expect(mockCallTool).toHaveBeenCalledWith('navigate', { path: '/dashboard', replace: true });
    expect(mockFormatResultForPlatform).toHaveBeenCalledWith(rawResult, 'claude');
  });

  it('callTool works without args parameter', async () => {
    const rawResult = { content: [{ type: 'text', text: 'done' }] };
    const mockCallTool = jest.fn().mockResolvedValue(rawResult);
    mockFormatResultForPlatform.mockReturnValue('done');

    const server = { callTool: mockCallTool } as unknown as DirectMcpServer;
    const handler = createToolCallHandler(server, 'vercel-ai');

    const result = await handler.callTool('go_back');

    expect(mockCallTool).toHaveBeenCalledWith('go_back', undefined);
    expect(result).toBe('done');
  });

  it('propagates errors from server.callTool', async () => {
    const mockCallTool = jest.fn().mockRejectedValue(new Error('server error'));

    const server = { callTool: mockCallTool } as unknown as DirectMcpServer;
    const handler = createToolCallHandler(server, 'openai');

    await expect(handler.callTool('broken_tool', {})).rejects.toThrow('server error');
  });

  it('works with different platforms', async () => {
    const rawResult = { content: [{ type: 'text', text: 'test' }] };
    const mockCallTool = jest.fn().mockResolvedValue(rawResult);

    const platforms = ['openai', 'claude', 'langchain', 'vercel-ai', 'raw'] as const;
    for (const platform of platforms) {
      mockFormatResultForPlatform.mockReturnValue(`result-${platform}`);

      const server = { callTool: mockCallTool } as unknown as DirectMcpServer;
      const handler = createToolCallHandler(server, platform);

      const result = await handler.callTool('tool', {});
      expect(result).toBe(`result-${platform}`);
      expect(mockFormatResultForPlatform).toHaveBeenCalledWith(rawResult, platform);
    }
  });
});
