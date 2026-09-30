/**
 * @jest-environment jsdom
 */
/**
 * Hooks over the shared IIFE bridge (#645).
 *
 * The IIFE bridge is one object that finishes its handshake after the provider
 * mounts, so the provider cannot rely on a new `bridge` reference to refresh
 * capabilities, theme, host context and tool data.
 */
import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { McpBridgeProvider, useCapability, useHostContext, useTheme } from '../context';
import { useToolInput, useToolOutput } from '../tools';

interface FakeBridge {
  initialized: boolean;
  capabilities: Record<string, boolean>;
  theme: string;
  hostContext: Record<string, unknown>;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  listeners: Array<(changes: Record<string, unknown>) => void>;
  resultListeners: Array<(result: unknown) => void>;
}

function installBridge(): FakeBridge {
  const state: FakeBridge = {
    initialized: false,
    capabilities: {},
    theme: 'light',
    hostContext: {},
    toolInput: {},
    toolOutput: undefined,
    listeners: [],
    resultListeners: [],
  };
  const bridge = {
    get initialized() {
      return state.initialized;
    },
    get capabilities() {
      return state.capabilities;
    },
    callTool: () => Promise.resolve({}),
    getTheme: () => state.theme,
    getHostContext: () => state.hostContext,
    getToolInput: () => state.toolInput,
    getToolOutput: () => state.toolOutput,
    getStructuredContent: () => state.toolOutput,
    onContextChange: (cb: (changes: Record<string, unknown>) => void) => {
      state.listeners.push(cb);
      return () => undefined;
    },
    onToolResult: (cb: (result: unknown) => void) => {
      state.resultListeners.push(cb);
      return () => undefined;
    },
  };
  (globalThis as Record<string, unknown>)['FrontMcpBridge'] = bridge;
  return state;
}

const wrapper = ({ children }: { children: ReactNode }) => <McpBridgeProvider>{children}</McpBridgeProvider>;

describe('hooks over a shared bridge that initializes after mount', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['FrontMcpBridge'];
  });

  it('refreshes capabilities, theme and host context on bridge:ready', () => {
    const state = installBridge();
    const { result } = renderHook(
      () => ({ can: useCapability('canCallTools'), theme: useTheme(), host: useHostContext() }),
      { wrapper },
    );
    expect(result.current.can).toBe(false);
    expect(result.current.theme).toBe('light');

    state.capabilities = { canCallTools: true };
    state.theme = 'dark';
    state.hostContext = { theme: 'dark', locale: 'fr-FR' };
    state.initialized = true;
    act(() => {
      window.dispatchEvent(new Event('bridge:ready'));
    });

    expect(result.current.can).toBe(true);
    expect(result.current.theme).toBe('dark');
    expect(result.current.host).toMatchObject({ theme: 'dark', locale: 'fr-FR' });
  });

  it('applies host context changes even before an initial context was read', () => {
    const state = installBridge();
    state.initialized = true;
    const { result } = renderHook(() => useHostContext(), { wrapper });

    act(() => {
      for (const cb of state.listeners) cb({ displayMode: 'fullscreen' });
    });

    expect(result.current).toMatchObject({ displayMode: 'fullscreen' });
  });

  it('reads the tool output that was set during the handshake and follows later results', () => {
    const state = installBridge();
    const { result } = renderHook(() => useToolOutput<{ temp: number }>(), { wrapper });
    expect(result.current).toBeNull();

    state.toolOutput = { temp: 18 };
    state.initialized = true;
    act(() => {
      window.dispatchEvent(new Event('bridge:ready'));
    });
    expect(result.current).toEqual({ temp: 18 });

    act(() => {
      for (const cb of state.resultListeners) cb({ temp: 21 });
    });
    expect(result.current).toEqual({ temp: 21 });
  });

  it('re-renders useToolInput when the host sends tool input', () => {
    const state = installBridge();
    state.initialized = true;
    const { result } = renderHook(() => useToolInput<{ city?: string }>(), { wrapper });
    expect(result.current).toEqual({});

    state.toolInput = { city: 'Paris' };
    act(() => {
      window.dispatchEvent(new CustomEvent('tool:input', { detail: { arguments: state.toolInput } }));
    });
    expect(result.current).toEqual({ city: 'Paris' });
  });
});
