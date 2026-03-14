import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useReadResource } from '../useReadResource';
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

describe('useReadResource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  describe('lazy mode (no URI)', () => {
    it('returns [readFn, state] tuple', () => {
      const { result } = renderHook(() => useReadResource(), {
        wrapper: createWrapper(),
      });

      const [readFn, state] = result.current as [unknown, unknown];
      expect(typeof readFn).toBe('function');
      expect(state).toEqual({ data: null, loading: false, error: null });
    });

    it('reads on demand when readFn is called', async () => {
      const resourceData = { contents: [{ text: 'hello' }] };
      mockClient.readResource.mockResolvedValueOnce(resourceData);

      const { result } = renderHook(() => useReadResource(), {
        wrapper: createWrapper(),
      });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      let returnValue: unknown;
      await act(async () => {
        returnValue = await readFn('app://info');
      });

      expect(mockClient.readResource).toHaveBeenCalledWith('app://info');
      expect(returnValue).toEqual(resourceData);

      const [, state] = result.current as [unknown, { data: unknown; loading: boolean; error: Error | null }];
      expect(state.data).toEqual(resourceData);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('handles errors in lazy mode', async () => {
      const error = new Error('read failed');
      mockClient.readResource.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useReadResource(), {
        wrapper: createWrapper(),
      });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      let returnValue: unknown;
      await act(async () => {
        returnValue = await readFn('app://broken');
      });

      expect(returnValue).toBeNull();

      const [, state] = result.current as [unknown, { data: unknown; loading: boolean; error: Error | null }];
      expect(state.error).toBe(error);
      expect(state.data).toBeNull();
    });

    it('wraps non-Error throw in an Error', async () => {
      mockClient.readResource.mockRejectedValueOnce('string error');

      const { result } = renderHook(() => useReadResource(), {
        wrapper: createWrapper(),
      });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      await act(async () => {
        await readFn('app://x');
      });

      const [, state] = result.current as [unknown, { error: Error | null }];
      expect(state.error).toBeInstanceOf(Error);
      expect(state.error?.message).toBe('string error');
    });

    it('handles not-connected state', async () => {
      const { result } = renderHook(() => useReadResource(), {
        wrapper: createWrapper({ status: 'idle', client: null }),
      });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      let returnValue: unknown;
      await act(async () => {
        returnValue = await readFn('app://info');
      });

      expect(returnValue).toBeNull();
      expect(mockClient.readResource).not.toHaveBeenCalled();

      const [, state] = result.current as [unknown, { error: Error | null }];
      expect(state.error).toBeDefined();
      expect(state.error?.message).toBe('FrontMCP not connected');
    });
  });

  describe('auto-fetch mode (with URI)', () => {
    it('fetches on mount when connected', async () => {
      const resourceData = { contents: [{ text: 'auto' }] };
      mockClient.readResource.mockResolvedValueOnce(resourceData);

      const { result } = renderHook(() => useReadResource('app://info'), {
        wrapper: createWrapper(),
      });

      // Wait for the useEffect to fire
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const state = result.current as { data: unknown; loading: boolean; error: Error | null; refetch: () => void };
      expect(mockClient.readResource).toHaveBeenCalledWith('app://info');
      expect(state.data).toEqual(resourceData);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(typeof state.refetch).toBe('function');
    });

    it('handles errors in auto-fetch mode', async () => {
      const error = new Error('auto-fetch failed');
      mockClient.readResource.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useReadResource('app://broken'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const state = result.current as { data: unknown; error: Error | null };
      expect(state.error).toBe(error);
      expect(state.data).toBeNull();
    });

    it('does not fetch when not connected', async () => {
      const { result } = renderHook(() => useReadResource('app://info'), {
        wrapper: createWrapper({ status: 'idle', client: null }),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockClient.readResource).not.toHaveBeenCalled();

      const state = result.current as { data: unknown; loading: boolean };
      expect(state.data).toBeNull();
    });

    it('refetch function re-reads the resource', async () => {
      mockClient.readResource
        .mockResolvedValueOnce({ contents: [{ text: 'first' }] })
        .mockResolvedValueOnce({ contents: [{ text: 'second' }] });

      const { result } = renderHook(() => useReadResource('app://info'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const state1 = result.current as { data: unknown; refetch: () => void };
      expect(state1.data).toEqual({ contents: [{ text: 'first' }] });

      await act(async () => {
        state1.refetch();
        await new Promise((r) => setTimeout(r, 0));
      });

      const state2 = result.current as { data: unknown };
      expect(state2.data).toEqual({ contents: [{ text: 'second' }] });
      expect(mockClient.readResource).toHaveBeenCalledTimes(2);
    });
  });

  describe('multi-server', () => {
    it('targets named server in lazy mode', async () => {
      const remoteClient = {
        ...mockClient,
        readResource: jest.fn().mockResolvedValue({ remote: true }),
      };

      serverRegistry.register('remote', {} as DirectMcpServer);
      serverRegistry.update('remote', {
        client: remoteClient as unknown as DirectClient,
        status: 'connected',
      });

      const { result } = renderHook(() => useReadResource({ server: 'remote' }), { wrapper: createWrapper() });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      await act(async () => {
        await readFn('app://remote-data');
      });

      expect(remoteClient.readResource).toHaveBeenCalledWith('app://remote-data');
      expect(mockClient.readResource).not.toHaveBeenCalled();
    });

    it('targets named server in auto-fetch mode', async () => {
      const remoteClient = {
        ...mockClient,
        readResource: jest.fn().mockResolvedValue({ remote: true }),
      };

      serverRegistry.register('remote', {} as DirectMcpServer);
      serverRegistry.update('remote', {
        client: remoteClient as unknown as DirectClient,
        status: 'connected',
      });

      const { result } = renderHook(() => useReadResource('app://data', { server: 'remote' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(remoteClient.readResource).toHaveBeenCalledWith('app://data');
      expect(mockClient.readResource).not.toHaveBeenCalled();

      const state = result.current as { data: unknown };
      expect(state.data).toEqual({ remote: true });
    });

    it('returns error when named server is not connected', async () => {
      serverRegistry.register('offline', {} as DirectMcpServer);

      const { result } = renderHook(() => useReadResource({ server: 'offline' }), { wrapper: createWrapper() });

      const [readFn] = result.current as [(uri: string) => Promise<unknown>, unknown];

      await act(async () => {
        await readFn('app://data');
      });

      const [, state] = result.current as [unknown, { error: Error | null }];
      expect(state.error).toBeDefined();
      expect(state.error?.message).toBe('FrontMCP not connected');
    });
  });

  describe('options-only overload', () => {
    it('accepts options object without URI (lazy mode with server)', () => {
      const { result } = renderHook(() => useReadResource({ server: 'default' }), { wrapper: createWrapper() });

      const [readFn, state] = result.current as [Function, { data: unknown; loading: boolean; error: Error | null }];
      expect(typeof readFn).toBe('function');
      expect(state).toEqual({ data: null, loading: false, error: null });
    });
  });
});
