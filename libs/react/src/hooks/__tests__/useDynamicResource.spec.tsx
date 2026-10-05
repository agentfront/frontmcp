import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import type { ReadResourceResult } from '@frontmcp/sdk';

import { ComponentRegistry } from '../../components/ComponentRegistry';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import { useDynamicResource } from '../useDynamicResource';

function createWrapper(dynamicRegistry: DynamicRegistry) {
  const ctx: FrontMcpContextValue = {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: async () => {},
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
  };
}

describe('useDynamicResource', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  it('registers resource on mount', () => {
    const read = async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: 'app://test', text: 'hello' }],
    });

    renderHook(
      () =>
        useDynamicResource({
          uri: 'app://test',
          name: 'test-resource',
          description: 'A test resource',
          mimeType: 'text/plain',
          read,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasResource('app://test')).toBe(true);
    const res = dynamicRegistry.findResource('app://test');
    expect(res).toBeDefined();
    expect(res!.name).toBe('test-resource');
    expect(res!.description).toBe('A test resource');
    expect(res!.mimeType).toBe('text/plain');
  });

  it('resource read returns data from the read function', async () => {
    const read = async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: 'app://data', mimeType: 'application/json', text: '{"x":1}' }],
    });

    renderHook(
      () =>
        useDynamicResource({
          uri: 'app://data',
          name: 'data-resource',
          read,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    const res = dynamicRegistry.findResource('app://data')!;
    const result = await res.read();
    expect(result.contents[0].text).toBe('{"x":1}');
  });

  it('does not register when enabled=false', () => {
    const read = async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: 'app://disabled', text: 'x' }],
    });

    renderHook(
      () =>
        useDynamicResource({
          uri: 'app://disabled',
          name: 'disabled-resource',
          read,
          enabled: false,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasResource('app://disabled')).toBe(false);
  });

  it('unregisters on unmount', () => {
    const read = async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: 'app://cleanup', text: 'x' }],
    });

    const { unmount } = renderHook(
      () =>
        useDynamicResource({
          uri: 'app://cleanup',
          name: 'cleanup-resource',
          read,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasResource('app://cleanup')).toBe(true);
    unmount();
    expect(dynamicRegistry.hasResource('app://cleanup')).toBe(false);
  });

  it('uses latest read function via ref (no stale closures)', async () => {
    let counter = 0;
    const read = async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: 'app://counter', text: String(counter) }],
    });

    const { rerender } = renderHook(
      () =>
        useDynamicResource({
          uri: 'app://counter',
          name: 'counter-resource',
          read,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    counter = 42;
    rerender();

    const res = dynamicRegistry.findResource('app://counter')!;
    const result = await res.read();
    expect(result.contents[0].text).toBe('42');
  });

  it('reads through the committed read function while a newer render is suspended', async () => {
    const textResult = (text: string): ReadResourceResult => ({ contents: [{ uri: 'app://doc', text }] });
    const committedRead = jest.fn(async () => textResult('committed'));
    const discardedRead = jest.fn(async () => textResult('discarded'));
    const neverSettles = new Promise<never>(() => undefined);
    function DocResource({ committed }: { committed: boolean }) {
      useDynamicResource({ uri: 'app://doc', name: 'doc', read: committed ? committedRead : discardedRead });
      if (!committed) throw neverSettles;
      return null;
    }
    const Wrapper = createWrapper(dynamicRegistry);
    const tree = (committed: boolean) => (
      <Wrapper>
        <React.Suspense fallback={null}>
          <DocResource committed={committed} />
        </React.Suspense>
      </Wrapper>
    );
    const { rerender } = render(tree(true));

    await act(async () => {
      React.startTransition(() => rerender(tree(false)));
    });
    const result = await dynamicRegistry.findResource('app://doc')?.read();

    expect(result).toEqual(textResult('committed'));
    expect(discardedRead).not.toHaveBeenCalled();
  });
});
