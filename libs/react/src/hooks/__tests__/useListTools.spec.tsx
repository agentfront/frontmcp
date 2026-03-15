import React from 'react';
import { renderHook } from '@testing-library/react';
import { useListTools } from '../useListTools';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue, ToolInfo } from '../../types';
import type { DirectMcpServer } from '@frontmcp/sdk';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockServer = {} as DirectMcpServer;

function createWrapper(overrides?: { tools?: ToolInfo[]; name?: string }) {
  const name = overrides?.name ?? 'default';
  serverRegistry.register(name, mockServer);
  if (overrides?.tools) {
    serverRegistry.update(name, { tools: overrides.tools, status: 'connected' });
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

describe('useListTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns tools from registry', () => {
    const tools: ToolInfo[] = [
      { name: 'search', description: 'Search for items' },
      { name: 'calculate', description: 'Perform calculation', inputSchema: { type: 'object' } },
    ];

    const { result } = renderHook(() => useListTools(), {
      wrapper: createWrapper({ tools }),
    });

    expect(result.current).toEqual(tools);
    expect(result.current).toHaveLength(2);
  });

  it('returns empty array when no tools exist', () => {
    const { result } = renderHook(() => useListTools(), {
      wrapper: createWrapper({ tools: [] }),
    });

    expect(result.current).toEqual([]);
    expect(result.current).toHaveLength(0);
  });

  it('returns tools without options argument', () => {
    const tools: ToolInfo[] = [{ name: 'tool-a' }];

    const { result } = renderHook(() => useListTools(), {
      wrapper: createWrapper({ tools }),
    });

    expect(result.current).toEqual(tools);
  });

  it('returns tools with explicit undefined server option', () => {
    const tools: ToolInfo[] = [{ name: 'tool-b' }];

    const { result } = renderHook(() => useListTools({ server: undefined }), {
      wrapper: createWrapper({ tools }),
    });

    expect(result.current).toEqual(tools);
  });

  describe('multi-server', () => {
    it('returns tools from named server in registry', () => {
      const remoteTools: ToolInfo[] = [{ name: 'remote-search', description: 'Remote search' }];

      serverRegistry.register('analytics', {} as DirectMcpServer);
      serverRegistry.update('analytics', { tools: remoteTools });

      const contextTools: ToolInfo[] = [{ name: 'local-tool' }];

      const { result } = renderHook(() => useListTools({ server: 'analytics' }), {
        wrapper: createWrapper({ tools: contextTools }),
      });

      expect(result.current).toEqual(remoteTools);
      // Should NOT return context tools
      expect(result.current).not.toContainEqual({ name: 'local-tool' });
    });

    it('returns empty array when named server has no tools', () => {
      serverRegistry.register('empty', {} as DirectMcpServer);

      const { result } = renderHook(() => useListTools({ server: 'empty' }), {
        wrapper: createWrapper({ tools: [{ name: 'local' }] }),
      });

      expect(result.current).toEqual([]);
    });

    it('returns empty array when named server does not exist', () => {
      const { result } = renderHook(() => useListTools({ server: 'nonexistent' }), {
        wrapper: createWrapper({ tools: [{ name: 'local' }] }),
      });

      expect(result.current).toEqual([]);
    });
  });
});
