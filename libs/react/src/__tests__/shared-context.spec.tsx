import { act, renderHook } from '@testing-library/react';
import React from 'react';

import type { DirectMcpServer } from '@frontmcp/sdk';

import { ComponentRegistry } from '../components/ComponentRegistry';
import { FrontMcpContext } from '../provider/FrontMcpContext';
import { DynamicRegistry } from '../registry/DynamicRegistry';
import { serverRegistry } from '../registry/ServerRegistry';
import type { FrontMcpContextValue } from '../types';

jest.mock('@frontmcp/sdk', () => ({
  formatToolsForPlatform: (tools: unknown) => tools,
  formatResultForPlatform: (result: unknown) => result,
}));

jest.mock('@frontmcp/utils', () => ({
  processPlatformToolCalls: jest.fn(),
}));

/**
 * Each package entry point (`/state`, `/api`, `/ai`, ...) is bundled with its own copy of the
 * shared modules. `jest.isolateModules` reproduces that: it loads fresh module instances while
 * keeping a single React, and the context and registry must still be the provider's.
 */
function loadIsolated<T>(load: () => T): T {
  const React_ = jest.requireActual('react');
  let loaded!: T;
  jest.isolateModules(() => {
    jest.doMock('react', () => React_);
    loaded = load();
  });
  return loaded;
}

describe('shared FrontMcpContext across module instances', () => {
  const dynamicRegistry = new DynamicRegistry();
  const ctx: FrontMcpContextValue = {
    name: 'shared',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: jest.fn(),
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrontMcpContext.Provider value={ctx}>{children}</FrontMcpContext.Provider>
  );

  beforeEach(() => {
    serverRegistry.clear();
  });

  it('gives an isolated copy of the modules the same context object and registry', () => {
    const isolated = loadIsolated(() => ({
      context: require('../provider/FrontMcpContext').FrontMcpContext,
      registry: require('../registry/ServerRegistry').serverRegistry,
      DynamicRegistry: require('../registry/DynamicRegistry').DynamicRegistry,
    }));

    expect(isolated.DynamicRegistry).not.toBe(DynamicRegistry);
    expect(isolated.context).toBe(FrontMcpContext);
    expect(isolated.registry).toBe(serverRegistry);
  });

  it('useStoreResource from another module instance registers on the provider registry', () => {
    const { useStoreResource } = loadIsolated(() => require('../state/useStoreResource'));

    const { unmount } = renderHook(
      () =>
        useStoreResource({
          name: 'todos',
          getState: () => ({ items: [] }),
          subscribe: () => () => undefined,
        }),
      { wrapper },
    );

    expect(dynamicRegistry.getResources().map((r) => r.uri)).toContain('state://todos');
    unmount();
    expect(dynamicRegistry.getResources().map((r) => r.uri)).not.toContain('state://todos');
  });

  it('useApiClient from another module instance registers tools on the provider registry', () => {
    const { useApiClient } = loadIsolated(() => require('../api/useApiClient'));

    renderHook(
      () =>
        useApiClient({
          baseUrl: 'https://example.test',
          fetch: jest.fn(),
          prefix: 'shop',
          operations: [
            {
              operationId: 'listItems',
              method: 'GET',
              path: '/items',
              description: 'List items',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        } as never),
      { wrapper },
    );

    expect(dynamicRegistry.getTools().some((t) => t.name.includes('listItems'))).toBe(true);
  });

  it('useAITools and useTools from another module instance read the provider server entry', async () => {
    const { useAITools } = loadIsolated(() => require('../ai/useAITools'));
    const { useTools } = loadIsolated(() => require('../ai/useTools'));

    serverRegistry.register('shared', { callTool: jest.fn() } as unknown as DirectMcpServer);
    serverRegistry.update('shared', {
      status: 'connected',
      tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }],
    });

    const ai = renderHook(() => useAITools('openai'), { wrapper });
    const plain = renderHook(() => useTools('openai'), { wrapper });
    await act(async () => undefined);

    expect(ai.result.current.tools).not.toBeNull();
    expect(JSON.stringify(ai.result.current.tools)).toContain('ping');
    expect(plain.result.current.tools).not.toBeNull();
    expect(JSON.stringify(plain.result.current.tools)).toContain('ping');
  });
});
