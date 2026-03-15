import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useGetPrompt } from '../useGetPrompt';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClient = {
  listTools: jest.fn().mockResolvedValue([]),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  callTool: jest.fn(),
  readResource: jest.fn(),
  getPrompt: jest.fn(),
  subscribeResource: jest.fn().mockResolvedValue(undefined),
  unsubscribeResource: jest.fn().mockResolvedValue(undefined),
  onResourceUpdated: jest.fn().mockReturnValue(() => {}),
};

const mockServer = {} as DirectMcpServer;

function createWrapper(overrides?: { status?: string; client?: unknown; name?: string }) {
  const name = overrides?.name ?? 'default';

  serverRegistry.register(name, mockServer);
  if (overrides?.client !== undefined || overrides?.status !== undefined) {
    serverRegistry.update(name, {
      ...(overrides.client !== undefined ? { client: overrides.client as DirectClient } : {}),
      ...(overrides.status !== undefined ? { status: overrides.status as 'idle' | 'connected' | 'error' } : {}),
    });
  } else {
    serverRegistry.update(name, {
      client: mockClient as unknown as DirectClient,
      status: 'connected',
    });
  }

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGetPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns initial idle state', () => {
    const { result } = renderHook(() => useGetPrompt('my-prompt'), {
      wrapper: createWrapper(),
    });

    const [, state] = result.current;
    expect(state).toEqual({ data: null, loading: false, error: null });
  });

  it('fetches prompt with args successfully', async () => {
    const promptResult = {
      description: 'test prompt',
      messages: [{ role: 'user', content: { type: 'text', text: 'Hello World' } }],
    };
    mockClient.getPrompt.mockResolvedValueOnce(promptResult);

    const { result } = renderHook(() => useGetPrompt('my-prompt'), {
      wrapper: createWrapper(),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]({ name: 'Alice' });
    });

    expect(mockClient.getPrompt).toHaveBeenCalledWith('my-prompt', { name: 'Alice' });
    expect(returnValue).toEqual(promptResult);

    const [, state] = result.current;
    expect(state.data).toEqual(promptResult);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetches prompt without args', async () => {
    const promptResult = { messages: [] };
    mockClient.getPrompt.mockResolvedValueOnce(promptResult);

    const { result } = renderHook(() => useGetPrompt('no-args-prompt'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]();
    });

    expect(mockClient.getPrompt).toHaveBeenCalledWith('no-args-prompt', undefined);
    expect(result.current[1].data).toEqual(promptResult);
  });

  it('sets loading state during fetch', async () => {
    let resolvePrompt!: (v: unknown) => void;
    mockClient.getPrompt.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolvePrompt = res;
        }),
    );

    const { result } = renderHook(() => useGetPrompt('my-prompt'), {
      wrapper: createWrapper(),
    });

    expect(result.current[1].loading).toBe(false);

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = result.current[0]({ x: '1' });
    });

    expect(result.current[1].loading).toBe(true);

    await act(async () => {
      resolvePrompt({ messages: [] });
      await callPromise!;
    });

    expect(result.current[1].loading).toBe(false);
  });

  it('handles error from client.getPrompt', async () => {
    const error = new Error('prompt failed');
    mockClient.getPrompt.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useGetPrompt('bad-prompt'), {
      wrapper: createWrapper(),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]();
    });

    expect(returnValue).toBeNull();

    const [, state] = result.current;
    expect(state.error).toBe(error);
    expect(state.data).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('wraps non-Error throw in an Error', async () => {
    mockClient.getPrompt.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useGetPrompt('my-prompt'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]();
    });

    expect(result.current[1].error).toBeInstanceOf(Error);
    expect(result.current[1].error!.message).toBe('string error');
  });

  it('handles not-connected state', async () => {
    const { result } = renderHook(() => useGetPrompt('my-prompt'), {
      wrapper: createWrapper({ status: 'idle', client: null }),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]({ arg: 'val' });
    });

    expect(returnValue).toBeNull();
    expect(mockClient.getPrompt).not.toHaveBeenCalled();
    expect(result.current[1].error!.message).toBe('FrontMCP not connected');
  });

  describe('multi-server', () => {
    it('targets named server from registry', async () => {
      const remoteClient = {
        ...mockClient,
        getPrompt: jest
          .fn()
          .mockResolvedValue({ messages: [{ role: 'assistant', content: { type: 'text', text: 'remote' } }] }),
      };

      serverRegistry.register('remote', {} as DirectMcpServer);
      serverRegistry.update('remote', {
        client: remoteClient as unknown as DirectClient,
        status: 'connected',
      });

      const { result } = renderHook(() => useGetPrompt('remote-prompt', { server: 'remote' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current[0]({ q: 'test' });
      });

      expect(remoteClient.getPrompt).toHaveBeenCalledWith('remote-prompt', { q: 'test' });
      expect(mockClient.getPrompt).not.toHaveBeenCalled();
      expect(result.current[1].data).toBeTruthy();
    });

    it('returns error when named server is not connected', async () => {
      serverRegistry.register('offline', {} as DirectMcpServer);

      const { result } = renderHook(() => useGetPrompt('p', { server: 'offline' }), { wrapper: createWrapper() });

      await act(async () => {
        await result.current[0]();
      });

      expect(result.current[1].error!.message).toBe('FrontMCP not connected');
    });

    it('returns error when named server does not exist', async () => {
      const { result } = renderHook(() => useGetPrompt('p', { server: 'nonexistent' }), { wrapper: createWrapper() });

      await act(async () => {
        await result.current[0]();
      });

      expect(result.current[1].error!.message).toBe('FrontMCP not connected');
    });
  });
});
