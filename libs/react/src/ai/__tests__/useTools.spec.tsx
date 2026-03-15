import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { serverRegistry } from '../../registry/ServerRegistry';
import { useTools } from '../useTools';
import type { FrontMcpContextValue, ToolInfo } from '../../types';
import type { DirectMcpServer } from '@frontmcp/sdk';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@frontmcp/sdk', () => ({
  formatToolsForPlatform: jest.fn(() => [
    {
      type: 'function',
      function: { name: 'greet', description: 'Greet', parameters: { type: 'object', properties: {} } },
    },
  ]),
  formatResultForPlatform: jest.fn((r) => r),
}));

const mockProcessPlatformToolCalls = jest.fn();
jest.mock('@frontmcp/utils', () => ({
  processPlatformToolCalls: (...args: unknown[]) => mockProcessPlatformToolCalls(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockServer = {
  callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  connect: jest.fn(),
};

function createWrapper(overrides?: { tools?: ToolInfo[]; status?: string; name?: string }) {
  const name = overrides?.name ?? 'default';
  const defaultTools: ToolInfo[] = [
    { name: 'greet', description: 'Greet', inputSchema: { type: 'object', properties: {} } },
  ];

  serverRegistry.register(name, mockServer as never as DirectMcpServer);
  serverRegistry.update(name, {
    tools: overrides?.tools ?? defaultTools,
    status: (overrides?.status ?? 'connected') as 'idle' | 'connected' | 'error',
  });

  const ctx: FrontMcpContextValue = {
    name,
    registry: new ComponentRegistry(),
    dynamicRegistry: new DynamicRegistry(),
    getDynamicRegistry: () => new DynamicRegistry(),
    connect: jest.fn(),
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns formatted tools for openai platform', () => {
    const { result } = renderHook(() => useTools('openai'), { wrapper: createWrapper() });

    expect(result.current.tools).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns formatted tools for claude platform', () => {
    const { formatToolsForPlatform } = require('@frontmcp/sdk');
    formatToolsForPlatform.mockReturnValue([
      { name: 'greet', description: 'Greet', input_schema: { type: 'object', properties: {} } },
    ]);

    const { result } = renderHook(() => useTools('claude'), { wrapper: createWrapper() });

    expect(result.current.tools).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('returns formatted tools for vercel-ai platform', () => {
    const { formatToolsForPlatform } = require('@frontmcp/sdk');
    formatToolsForPlatform.mockReturnValue({ greet: { description: 'Greet', parameters: {} } });

    const { result } = renderHook(() => useTools('vercel-ai'), { wrapper: createWrapper() });

    expect(result.current.tools).toBeDefined();
    expect(result.current.loading).toBe(false);
  });

  it('processToolCalls delegates to processPlatformToolCalls from utils', async () => {
    const expectedResults = [{ role: 'tool', tool_call_id: 'tc-1', content: 'ok' }];
    mockProcessPlatformToolCalls.mockResolvedValue(expectedResults);

    const { result } = renderHook(() => useTools('openai'), { wrapper: createWrapper() });

    const toolCalls = [
      { id: 'tc-1', type: 'function' as const, function: { name: 'greet', arguments: '{"name":"World"}' } },
    ];

    let results: unknown;
    await act(async () => {
      results = await result.current.processToolCalls(toolCalls);
    });

    expect(results).toBe(expectedResults);
    expect(mockProcessPlatformToolCalls).toHaveBeenCalledWith('openai', toolCalls, expect.any(Function));
  });

  it('processToolCalls delegates for claude platform', async () => {
    const expectedResults = [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'done' }];
    mockProcessPlatformToolCalls.mockResolvedValue(expectedResults);

    const { result } = renderHook(() => useTools('claude'), { wrapper: createWrapper() });

    const blocks = [{ type: 'tool_use' as const, id: 'tu-1', name: 'greet', input: { name: 'World' } }];

    let results: unknown;
    await act(async () => {
      results = await result.current.processToolCalls(blocks);
    });

    expect(results).toBe(expectedResults);
    expect(mockProcessPlatformToolCalls).toHaveBeenCalledWith('claude', blocks, expect.any(Function));
  });

  it('processToolCalls delegates for vercel-ai platform', async () => {
    mockProcessPlatformToolCalls.mockResolvedValue('result');

    const { result } = renderHook(() => useTools('vercel-ai'), { wrapper: createWrapper() });

    const info = { toolCallId: 'vc-1', toolName: 'greet', args: { name: 'World' } };

    let res: unknown;
    await act(async () => {
      res = await result.current.processToolCalls(info);
    });

    expect(res).toBe('result');
    expect(mockProcessPlatformToolCalls).toHaveBeenCalledWith('vercel-ai', info, expect.any(Function));
  });

  it('supports multi-server via options.server', () => {
    const serverTools: ToolInfo[] = [{ name: 'remote', description: 'remote', inputSchema: { type: 'object' } }];
    const { formatToolsForPlatform } = require('@frontmcp/sdk');
    formatToolsForPlatform.mockReturnValue([{ name: 'remote' }]);

    // Register the analytics server
    serverRegistry.register('analytics', { callTool: jest.fn() } as never as DirectMcpServer);
    serverRegistry.update('analytics', {
      tools: serverTools,
      status: 'connected',
    });

    const { result } = renderHook(() => useTools('openai', { server: 'analytics' }), {
      wrapper: createWrapper({ tools: [], status: 'idle' }),
    });

    expect(result.current.tools).toBeDefined();
  });

  it('returns loading state when not connected', () => {
    const { result } = renderHook(() => useTools('openai'), { wrapper: createWrapper({ status: 'idle', tools: [] }) });

    expect(result.current.loading).toBe(true);
    expect(result.current.tools).toBeNull();
  });

  it('returns error state from underlying hook', () => {
    const { formatToolsForPlatform } = require('@frontmcp/sdk');
    formatToolsForPlatform.mockImplementation(() => {
      throw new Error('format failed');
    });

    const { result } = renderHook(() => useTools('openai'), { wrapper: createWrapper() });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('format failed');
  });
});
