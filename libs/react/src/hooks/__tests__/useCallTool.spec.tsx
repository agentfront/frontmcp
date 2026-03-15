import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useCallTool } from '../useCallTool';
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

  const dynamicRegistry = new DynamicRegistry();
  const ctx: FrontMcpContextValue = {
    name,
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: jest.fn(),
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCallTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns initial idle state', () => {
    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    const [, state] = result.current;
    expect(state).toEqual({ data: null, loading: false, error: null, called: false });
  });

  it('calls tool successfully and returns data', async () => {
    const toolResult = { content: [{ type: 'text', text: 'hello' }] };
    mockClient.callTool.mockResolvedValueOnce(toolResult);

    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]({ input: 'test' });
    });

    expect(mockClient.callTool).toHaveBeenCalledWith('my-tool', { input: 'test' });
    expect(returnValue).toEqual(toolResult);

    const [, state] = result.current;
    expect(state.data).toEqual(toolResult);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.called).toBe(true);
  });

  it('sets loading and called states correctly during execution', async () => {
    let resolveCall!: (v: unknown) => void;
    mockClient.callTool.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveCall = res;
        }),
    );

    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    // Before call
    expect(result.current[1].loading).toBe(false);
    expect(result.current[1].called).toBe(false);

    let callPromise: Promise<unknown>;
    await act(async () => {
      callPromise = result.current[0]({ x: 1 });
      // Yield a tick so the setState for loading fires within act
      await new Promise((r) => setTimeout(r, 0));
    });

    // During call — loading should be true, call hasn't resolved yet
    expect(result.current[1].loading).toBe(true);
    expect(result.current[1].called).toBe(true);

    await act(async () => {
      resolveCall({ ok: true });
      await callPromise!;
    });

    // After call
    expect(result.current[1].loading).toBe(false);
    expect(result.current[1].called).toBe(true);
  });

  it('handles error from client.callTool', async () => {
    const error = new Error('tool failed');
    mockClient.callTool.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]({ a: 1 });
    });

    expect(returnValue).toBeNull();

    const [, state] = result.current;
    expect(state.error).toBe(error);
    expect(state.data).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.called).toBe(true);
  });

  it('wraps non-Error throw in an Error', async () => {
    mockClient.callTool.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]({});
    });

    expect(result.current[1].error).toBeInstanceOf(Error);
    expect(result.current[1].error!.message).toBe('string error');
  });

  it('handles not-connected state', async () => {
    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper({ status: 'idle', client: null }),
    });

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current[0]({ a: 1 });
    });

    expect(returnValue).toBeNull();
    expect(result.current[1].error).toBeInstanceOf(Error);
    expect(result.current[1].error!.message).toBe('FrontMCP not connected');
    expect(result.current[1].called).toBe(true);
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('resets state on tool name change when resetOnToolChange is true (default)', async () => {
    mockClient.callTool.mockResolvedValue({ ok: true });

    const { result, rerender } = renderHook(({ name }: { name: string }) => useCallTool(name), {
      wrapper: createWrapper(),
      initialProps: { name: 'tool-a' },
    });

    // Simulate a call to set state
    await act(async () => {
      await result.current[0]({ x: 1 });
    });

    expect(result.current[1].called).toBe(true);

    // Change tool name
    rerender({ name: 'tool-b' });

    expect(result.current[1]).toEqual({ data: null, loading: false, error: null, called: false });
  });

  it('does not reset state on tool name change when resetOnToolChange is false', async () => {
    mockClient.callTool.mockResolvedValue({ ok: true });

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useCallTool(name, { resetOnToolChange: false }),
      { wrapper: createWrapper(), initialProps: { name: 'tool-a' } },
    );

    await act(async () => {
      await result.current[0]({ x: 1 });
    });

    expect(result.current[1].called).toBe(true);

    rerender({ name: 'tool-b' });

    // State should NOT reset
    expect(result.current[1].called).toBe(true);
  });

  it('reset function clears state', async () => {
    mockClient.callTool.mockResolvedValueOnce({ res: 'ok' });

    const { result } = renderHook(() => useCallTool('my-tool'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]({ a: 1 });
    });

    expect(result.current[1].data).toEqual({ res: 'ok' });

    act(() => {
      result.current[2](); // reset
    });

    expect(result.current[1]).toEqual({ data: null, loading: false, error: null, called: false });
  });

  it('calls onSuccess callback on successful call', async () => {
    const onSuccess = jest.fn();
    const toolResult = { value: 42 };
    mockClient.callTool.mockResolvedValueOnce(toolResult);

    const { result } = renderHook(() => useCallTool('my-tool', { onSuccess }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]({});
    });

    expect(onSuccess).toHaveBeenCalledWith(toolResult);
  });

  it('calls onError callback on failure', async () => {
    const onError = jest.fn();
    const error = new Error('boom');
    mockClient.callTool.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useCallTool('my-tool', { onError }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current[0]({});
    });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('calls onError callback when not connected', async () => {
    const onError = jest.fn();

    const { result } = renderHook(() => useCallTool('my-tool', { onError }), {
      wrapper: createWrapper({ status: 'idle', client: null }),
    });

    await act(async () => {
      await result.current[0]({});
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'FrontMCP not connected' }));
  });

  describe('multi-server', () => {
    it('targets named server from registry', async () => {
      const remoteClient = {
        ...mockClient,
        callTool: jest.fn().mockResolvedValue({ remote: true }),
      };

      const remoteServer = {} as DirectMcpServer;
      serverRegistry.register('analytics', remoteServer);
      serverRegistry.update('analytics', {
        client: remoteClient as unknown as DirectClient,
        status: 'connected',
      });

      const { result } = renderHook(() => useCallTool('remote-tool', { server: 'analytics' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current[0]({ q: 'events' });
      });

      expect(remoteClient.callTool).toHaveBeenCalledWith('remote-tool', { q: 'events' });
      expect(result.current[1].data).toEqual({ remote: true });
      // The default client should NOT have been called
      expect(mockClient.callTool).not.toHaveBeenCalled();
    });

    it('returns error when named server is not connected', async () => {
      serverRegistry.register('offline', {} as DirectMcpServer);
      // status stays 'idle', client stays null

      const { result } = renderHook(() => useCallTool('remote-tool', { server: 'offline' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current[0]({ x: 1 });
      });

      expect(result.current[1].error!.message).toBe('FrontMCP not connected');
    });

    it('returns error when named server is not registered', async () => {
      const { result } = renderHook(() => useCallTool('remote-tool', { server: 'nonexistent' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current[0]({});
      });

      expect(result.current[1].error!.message).toBe('FrontMCP not connected');
    });
  });
});
