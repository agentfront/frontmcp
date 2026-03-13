import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useStoreResource } from '../useStoreResource';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
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
    connect: jest.fn(),
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useStoreResource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('fetches resource on mount when connected', async () => {
    const resourceResult = { contents: [{ text: '{"count":42}' }] };
    mockClient.readResource.mockResolvedValueOnce(resourceResult);

    const { result } = renderHook(() => useStoreResource('state://counter'), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockClient.readResource).toHaveBeenCalledWith('state://counter');
    expect(result.current.data).toEqual({ count: 42 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('subscribes to resource updates', async () => {
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"initial"' }] });

    renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockClient.subscribeResource).toHaveBeenCalledWith('state://data');
    expect(mockClient.onResourceUpdated).toHaveBeenCalledWith(expect.any(Function));
  });

  it('re-fetches on update notification', async () => {
    let updateCallback: ((uri: string) => void) | undefined;
    mockClient.onResourceUpdated.mockImplementation((cb: (uri: string) => void) => {
      updateCallback = cb;
      return () => {};
    });

    mockClient.readResource
      .mockResolvedValueOnce({ contents: [{ text: '{"v":1}' }] })
      .mockResolvedValueOnce({ contents: [{ text: '{"v":2}' }] });

    const { result } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toEqual({ v: 1 });

    // Simulate server notification
    await act(async () => {
      updateCallback!('state://data');
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toEqual({ v: 2 });
    expect(mockClient.readResource).toHaveBeenCalledTimes(2);
  });

  it('ignores update notifications for different URIs', async () => {
    let updateCallback: ((uri: string) => void) | undefined;
    mockClient.onResourceUpdated.mockImplementation((cb: (uri: string) => void) => {
      updateCallback = cb;
      return () => {};
    });

    mockClient.readResource.mockResolvedValue({ contents: [{ text: '{"v":1}' }] });

    renderHook(() => useStoreResource('state://mine'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const callCountAfterMount = mockClient.readResource.mock.calls.length;

    // Notify for a DIFFERENT URI
    await act(async () => {
      updateCallback!('state://other');
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockClient.readResource).toHaveBeenCalledTimes(callCountAfterMount);
  });

  it('handles errors during fetch', async () => {
    const error = new Error('fetch failed');
    mockClient.readResource.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useStoreResource('state://broken'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('wraps non-Error throw in an Error', async () => {
    mockClient.readResource.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useStoreResource('state://x'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe('string error');
  });

  it('parses JSON content from resource', async () => {
    const jsonData = { nested: { array: [1, 2, 3], flag: true } };
    mockClient.readResource.mockResolvedValueOnce({
      contents: [{ text: JSON.stringify(jsonData) }],
    });

    const { result } = renderHook(() => useStoreResource('state://json'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toEqual(jsonData);
  });

  it('returns raw text when content is not valid JSON', async () => {
    mockClient.readResource.mockResolvedValueOnce({
      contents: [{ text: 'plain text content' }],
    });

    const { result } = renderHook(() => useStoreResource('state://text'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toBe('plain text content');
  });

  it('returns raw result when contents structure is missing', async () => {
    const rawResult = { someOtherField: 'value' };
    mockClient.readResource.mockResolvedValueOnce(rawResult);

    const { result } = renderHook(() => useStoreResource('state://raw'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toEqual(rawResult);
  });

  it('returns raw result when contents array is empty', async () => {
    const rawResult = { contents: [] };
    mockClient.readResource.mockResolvedValueOnce(rawResult);

    const { result } = renderHook(() => useStoreResource('state://empty'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toEqual(rawResult);
  });

  it('refetch function re-reads the resource', async () => {
    mockClient.readResource
      .mockResolvedValueOnce({ contents: [{ text: '"first"' }] })
      .mockResolvedValueOnce({ contents: [{ text: '"second"' }] });

    const { result } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toBe('first');

    await act(async () => {
      result.current.refetch();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.data).toBe('second');
  });

  it('does not fetch when not connected', async () => {
    const { result } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper({ status: 'idle', client: null }),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockClient.readResource).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('handles unsubscribe failure on unmount gracefully', async () => {
    mockClient.onResourceUpdated.mockReturnValue(() => {});
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"ok"' }] });
    mockClient.unsubscribeResource.mockRejectedValue(new Error('unsub fail'));

    const { unmount } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should not throw even though unsubscribe fails
    unmount();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('handles unsubscribe failure in cancelled branch gracefully', async () => {
    let resolveSubscribe!: () => void;
    mockClient.subscribeResource.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveSubscribe = res;
        }),
    );
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"ok"' }] });
    mockClient.unsubscribeResource.mockRejectedValue(new Error('unsub fail'));

    const { unmount } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();

    // Resolve subscribe after unmount (cancelled branch) — unsubscribe will reject
    await act(async () => {
      resolveSubscribe();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('unsubscribes and cleans up on unmount', async () => {
    const unsubNotification = jest.fn();
    mockClient.onResourceUpdated.mockReturnValue(unsubNotification);
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"ok"' }] });

    const { unmount } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();

    expect(unsubNotification).toHaveBeenCalled();
    expect(mockClient.unsubscribeResource).toHaveBeenCalledWith('state://data');
  });

  it('cleans up when unmount happens before subscription completes', async () => {
    // Make subscribeResource hang long enough for the unmount to happen first
    let resolveSubscribe!: () => void;
    mockClient.subscribeResource.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveSubscribe = res;
        }),
    );
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"ok"' }] });

    const { unmount } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Unmount before subscription resolves — sets cancelled = true
    unmount();

    // Now resolve the subscription — the cancelled branch should fire
    await act(async () => {
      resolveSubscribe();
      await new Promise((r) => setTimeout(r, 0));
    });

    // unsubscribeResource should be called from the cancelled branch
    expect(mockClient.unsubscribeResource).toHaveBeenCalledWith('state://data');
  });

  it('handles subscription failure gracefully', async () => {
    mockClient.subscribeResource.mockRejectedValueOnce(new Error('not supported'));
    mockClient.readResource.mockResolvedValueOnce({ contents: [{ text: '"ok"' }] });

    const { result } = renderHook(() => useStoreResource('state://data'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should still fetch successfully even if subscribe fails
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeNull();
  });

  describe('multi-server', () => {
    it('targets named server from registry', async () => {
      const remoteClient = {
        ...mockClient,
        readResource: jest.fn().mockResolvedValue({ contents: [{ text: '{"remote":true}' }] }),
        subscribeResource: jest.fn().mockResolvedValue(undefined),
        unsubscribeResource: jest.fn().mockResolvedValue(undefined),
        onResourceUpdated: jest.fn().mockReturnValue(() => {}),
      };

      serverRegistry.register('state-server', {} as DirectMcpServer);
      serverRegistry.update('state-server', {
        client: remoteClient as unknown as DirectClient,
        status: 'connected',
      });

      const { result } = renderHook(() => useStoreResource('state://counter', { server: 'state-server' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(remoteClient.readResource).toHaveBeenCalledWith('state://counter');
      expect(mockClient.readResource).not.toHaveBeenCalled();
      expect(result.current.data).toEqual({ remote: true });
    });

    it('does not fetch when named server is not connected', async () => {
      serverRegistry.register('offline', {} as DirectMcpServer);

      const { result } = renderHook(() => useStoreResource('state://data', { server: 'offline' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockClient.readResource).not.toHaveBeenCalled();
      expect(result.current.data).toBeNull();
    });

    it('does not fetch when named server does not exist', async () => {
      const { result } = renderHook(() => useStoreResource('state://data', { server: 'nonexistent' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockClient.readResource).not.toHaveBeenCalled();
      expect(result.current.data).toBeNull();
    });
  });

  describe('initial loading state', () => {
    it('starts with loading: true before connection resolves', () => {
      const { result } = renderHook(() => useStoreResource('state://data'), {
        wrapper: createWrapper({ status: 'idle', client: null }),
      });

      // When not connected, the effect doesn't run but initial state is loading: true
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
