import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { FrontMcpContextValue, ToolInfo } from '../../types';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { useAITools } from '../useAITools';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFormatToolsForPlatform = jest.fn();
const mockFormatResultForPlatform = jest.fn();

jest.mock('@frontmcp/sdk', () => ({
  formatToolsForPlatform: (...args: unknown[]) => mockFormatToolsForPlatform(...args),
  formatResultForPlatform: (...args: unknown[]) => mockFormatResultForPlatform(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper(overrides?: {
  name?: string;
  tools?: ToolInfo[];
  status?: string;
  server?: DirectMcpServer;
  client?: DirectClient | null;
}) {
  const name = overrides?.name ?? 'default';
  const srv = overrides?.server ?? ({ callTool: jest.fn() } as never as DirectMcpServer);

  serverRegistry.register(name, srv);
  serverRegistry.update(name, {
    tools: overrides?.tools ?? [],
    status: (overrides?.status ?? 'connected') as 'idle' | 'connected' | 'error',
    ...(overrides?.client !== undefined ? { client: overrides.client } : {}),
  });

  const ctx: FrontMcpContextValue = {
    name,
    registry: new ComponentRegistry(),
    dynamicRegistry: new DynamicRegistry(),
    getDynamicRegistry: () => new DynamicRegistry(),
    connect: jest.fn(),
  };

  return ({ children }: { children: React.ReactNode }) => (
    <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useAITools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('formats tools for platform when connected', async () => {
    const tools: ToolInfo[] = [
      { name: 'tool1', description: 'desc1', inputSchema: { type: 'object' } },
      { name: 'tool2', description: 'desc2', inputSchema: { type: 'object' } },
    ];
    const formatted = [{ type: 'function', function: { name: 'tool1' } }];
    mockFormatToolsForPlatform.mockReturnValue(formatted);

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ tools, status: 'connected' }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tools).toBe(formatted);
    expect(result.current.error).toBeNull();
    expect(mockFormatToolsForPlatform).toHaveBeenCalledWith(
      [
        { name: 'tool1', description: 'desc1', inputSchema: { type: 'object' } },
        { name: 'tool2', description: 'desc2', inputSchema: { type: 'object' } },
      ],
      'openai',
    );
  });

  it('returns null tools when not connected', async () => {
    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ status: 'idle', tools: [] }),
    });

    // When idle, loading should be true and tools null
    expect(result.current.tools).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('returns null tools when no tools have inputSchema', async () => {
    const tools: ToolInfo[] = [{ name: 'tool1', description: 'no schema' }, { name: 'tool2' }];

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ tools, status: 'connected' }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tools).toBeNull();
    expect(mockFormatToolsForPlatform).not.toHaveBeenCalled();
  });

  it('callTool calls server.callTool and formats result', async () => {
    const rawResult = { content: [{ type: 'text', text: 'ok' }] };
    const formattedResult = 'ok';
    const mockCallTool = jest.fn().mockResolvedValue(rawResult);
    mockFormatResultForPlatform.mockReturnValue(formattedResult);
    mockFormatToolsForPlatform.mockReturnValue([]);

    const tools: ToolInfo[] = [{ name: 'my_tool', description: 'test', inputSchema: { type: 'object' } }];

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({
        tools,
        status: 'connected',
        server: { callTool: mockCallTool } as never as DirectMcpServer,
      }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let callResult: unknown;
    await act(async () => {
      callResult = await result.current.callTool('my_tool', { input: 'hello' });
    });

    expect(mockCallTool).toHaveBeenCalledWith('my_tool', { input: 'hello' });
    expect(mockFormatResultForPlatform).toHaveBeenCalledWith(rawResult, 'openai');
    expect(callResult).toBe(formattedResult);
  });

  it('callTool throws when server unavailable', async () => {
    const tools: ToolInfo[] = [{ name: 'tool1', inputSchema: { type: 'object' } }];
    mockFormatToolsForPlatform.mockReturnValue([]);

    // Register with a null-ish server
    serverRegistry.register('default', null as never as DirectMcpServer);
    serverRegistry.update('default', { tools, status: 'connected' });

    const ctx: FrontMcpContextValue = {
      name: 'default',
      registry: new ComponentRegistry(),
      dynamicRegistry: new DynamicRegistry(),
      getDynamicRegistry: () => new DynamicRegistry(),
      connect: jest.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>
    );

    const { result } = renderHook(() => useAITools('openai'), { wrapper });

    await expect(result.current.callTool('tool1', {})).rejects.toThrow('FrontMCP server not available');
  });

  it('handles formatting error', async () => {
    const tools: ToolInfo[] = [{ name: 'tool1', inputSchema: { type: 'object' } }];
    mockFormatToolsForPlatform.mockImplementation(() => {
      throw new Error('format failed');
    });

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ tools, status: 'connected' }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('format failed');
    expect(result.current.tools).toBeNull();
  });

  it('handles non-Error thrown during formatting', async () => {
    const tools: ToolInfo[] = [{ name: 'tool1', inputSchema: { type: 'object' } }];
    mockFormatToolsForPlatform.mockImplementation(() => {
      throw 'string error';
    });

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ tools, status: 'connected' }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string error');
  });

  it('multi-server support via options.server', async () => {
    const serverTools: ToolInfo[] = [{ name: 'remote_tool', description: 'remote', inputSchema: { type: 'object' } }];
    const mockServerCallTool = jest.fn().mockResolvedValue({ content: [] });
    const formatted = [{ name: 'remote_tool' }];
    mockFormatToolsForPlatform.mockReturnValue(formatted);
    mockFormatResultForPlatform.mockReturnValue('result');

    // Register the named server in the real registry
    serverRegistry.register('analytics', { callTool: mockServerCallTool } as never as DirectMcpServer);
    serverRegistry.update('analytics', {
      tools: serverTools,
      status: 'connected',
    });

    // Provider context points to 'default' which is idle
    serverRegistry.register('default', {} as DirectMcpServer);

    const ctx: FrontMcpContextValue = {
      name: 'default',
      registry: new ComponentRegistry(),
      dynamicRegistry: new DynamicRegistry(),
      getDynamicRegistry: () => new DynamicRegistry(),
      connect: jest.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>
    );

    const { result } = renderHook(() => useAITools('claude', { server: 'analytics' }), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tools).toBe(formatted);

    // callTool should use the named server
    await act(async () => {
      await result.current.callTool('remote_tool', { x: 1 });
    });
    expect(mockServerCallTool).toHaveBeenCalledWith('remote_tool', { x: 1 });
  });

  it('callTool sets error and rethrows on server.callTool failure', async () => {
    const callToolError = new Error('call failed');
    const mockCallTool = jest.fn().mockRejectedValue(callToolError);
    mockFormatToolsForPlatform.mockReturnValue([]);

    const tools: ToolInfo[] = [{ name: 'tool1', inputSchema: { type: 'object' } }];

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({
        tools,
        status: 'connected',
        server: { callTool: mockCallTool } as never as DirectMcpServer,
      }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.callTool('tool1', {});
      }),
    ).rejects.toThrow('call failed');
  });

  it('callTool wraps non-Error thrown values', async () => {
    const mockCallTool = jest.fn().mockRejectedValue('raw string');
    mockFormatToolsForPlatform.mockReturnValue([]);

    const tools: ToolInfo[] = [{ name: 'tool1', inputSchema: { type: 'object' } }];

    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({
        tools,
        status: 'connected',
        server: { callTool: mockCallTool } as never as DirectMcpServer,
      }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.callTool('tool1', {});
      }),
    ).rejects.toThrow('raw string');
  });

  it('sets loading false and tools null when status is error', async () => {
    const { result } = renderHook(() => useAITools('openai'), {
      wrapper: makeWrapper({ status: 'error', tools: [] }),
    });

    // status=error should NOT be loading
    expect(result.current.loading).toBe(false);
    expect(result.current.tools).toBeNull();
  });

  it('multi-server returns null tools when server entry not registered', async () => {
    // Only register 'default', not 'nonexistent'
    serverRegistry.register('default', {} as DirectMcpServer);

    const ctx: FrontMcpContextValue = {
      name: 'default',
      registry: new ComponentRegistry(),
      dynamicRegistry: new DynamicRegistry(),
      getDynamicRegistry: () => new DynamicRegistry(),
      connect: jest.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>
    );

    const { result } = renderHook(() => useAITools('openai', { server: 'nonexistent' }), {
      wrapper,
    });

    // status from undefined entry defaults to 'idle' => loading = true
    expect(result.current.tools).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});
