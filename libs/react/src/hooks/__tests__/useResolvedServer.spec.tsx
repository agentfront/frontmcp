import React from 'react';
import { renderHook } from '@testing-library/react';
import { useResolvedServer } from '../useResolvedServer';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import type { DirectMcpServer } from '@frontmcp/sdk';

const mockServer = {} as DirectMcpServer;

function createWrapper(ctxOverrides: Partial<FrontMcpContextValue> = {}) {
  const defaultCtx: FrontMcpContextValue = {
    name: 'default',
    registry: new ComponentRegistry(),
    dynamicRegistry: new DynamicRegistry(),
    getDynamicRegistry: () => new DynamicRegistry(),
    connect: jest.fn(),
    ...ctxOverrides,
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: defaultCtx }, children);
}

describe('useResolvedServer', () => {
  beforeEach(() => {
    serverRegistry.clear();
  });

  it('resolves "default" entry when no arg is provided', () => {
    serverRegistry.register('default', mockServer);
    serverRegistry.update('default', { status: 'connected' });

    const { result } = renderHook(() => useResolvedServer(), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('default');
    expect(result.current.entry).toBeDefined();
    expect(result.current.entry?.status).toBe('connected');
  });

  it('resolves named server when arg is provided', () => {
    serverRegistry.register('analytics', mockServer);
    serverRegistry.update('analytics', { status: 'connected' });

    const { result } = renderHook(() => useResolvedServer('analytics'), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('analytics');
    expect(result.current.entry).toBeDefined();
    expect(result.current.entry?.status).toBe('connected');
  });

  it('uses context name when no arg provided', () => {
    serverRegistry.register('my-server', mockServer);

    const { result } = renderHook(() => useResolvedServer(), {
      wrapper: createWrapper({ name: 'my-server' }),
    });

    expect(result.current.name).toBe('my-server');
    expect(result.current.entry).toBeDefined();
  });

  it('returns undefined entry when server not registered', () => {
    const { result } = renderHook(() => useResolvedServer('nonexistent'), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('nonexistent');
    expect(result.current.entry).toBeUndefined();
  });

  it('provides registry and connect from context', () => {
    const registry = new ComponentRegistry();
    const connect = jest.fn();

    const { result } = renderHook(() => useResolvedServer(), {
      wrapper: createWrapper({ registry, connect }),
    });

    expect(result.current.registry).toBe(registry);
    expect(result.current.connect).toBe(connect);
  });
});
