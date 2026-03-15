import React from 'react';
import { renderHook } from '@testing-library/react';
import { useFrontMcp } from '../useFrontMcp';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';

const mockServer = {} as DirectMcpServer;
const mockClient = { callTool: jest.fn() } as unknown as DirectClient;

function createWrapper(ctxOverrides: Partial<FrontMcpContextValue> = {}) {
  const dynamicRegistry = new DynamicRegistry();
  const defaultCtx: FrontMcpContextValue = {
    name: 'default',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: jest.fn(),
    ...ctxOverrides,
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: defaultCtx }, children);
}

describe('useFrontMcp', () => {
  beforeEach(() => {
    serverRegistry.clear();
  });

  it('resolves the default entry from registry', () => {
    serverRegistry.register('default', mockServer);
    serverRegistry.update('default', {
      client: mockClient,
      status: 'connected',
      tools: [{ name: 'tool1' }],
    });

    const { result } = renderHook(() => useFrontMcp(), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('default');
    expect(result.current.server).toBe(mockServer);
    expect(result.current.client).toBe(mockClient);
    expect(result.current.status).toBe('connected');
    expect(result.current.tools).toEqual([{ name: 'tool1' }]);
    expect(result.current.error).toBeNull();
  });

  it('resolves a named server when name is provided', () => {
    const analyticsServer = {} as DirectMcpServer;
    serverRegistry.register('analytics', analyticsServer);
    serverRegistry.update('analytics', { status: 'connected' });

    const { result } = renderHook(() => useFrontMcp('analytics'), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('analytics');
    expect(result.current.server).toBe(analyticsServer);
    expect(result.current.status).toBe('connected');
  });

  it('returns defaults when entry is missing', () => {
    const { result } = renderHook(() => useFrontMcp(), {
      wrapper: createWrapper(),
    });

    expect(result.current.name).toBe('default');
    expect(result.current.server).toBeNull();
    expect(result.current.client).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.tools).toEqual([]);
    expect(result.current.resources).toEqual([]);
    expect(result.current.resourceTemplates).toEqual([]);
    expect(result.current.prompts).toEqual([]);
  });

  it('returns ResolvedServer shape with registry and connect', () => {
    const registry = new ComponentRegistry();
    const connect = jest.fn();

    const { result } = renderHook(() => useFrontMcp(), {
      wrapper: createWrapper({ registry, connect }),
    });

    expect(result.current.registry).toBe(registry);
    expect(result.current.connect).toBe(connect);
  });
});
