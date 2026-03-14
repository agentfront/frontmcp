import React from 'react';
import { renderHook } from '@testing-library/react';
import { useDynamicResource } from '../useDynamicResource';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import type { FrontMcpContextValue } from '../../types';
import type { ReadResourceResult } from '@frontmcp/sdk';

function createWrapper(dynamicRegistry: DynamicRegistry) {
  const ctx: FrontMcpContextValue = {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry,
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
});
