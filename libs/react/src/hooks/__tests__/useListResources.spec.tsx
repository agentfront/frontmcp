import React from 'react';
import { renderHook } from '@testing-library/react';
import { useListResources } from '../useListResources';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import type { FrontMcpContextValue, ResourceInfo, ResourceTemplateInfo } from '../../types';
import type { DirectMcpServer } from '@frontmcp/sdk';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockServer = {} as DirectMcpServer;

function createWrapper(overrides?: {
  resources?: ResourceInfo[];
  resourceTemplates?: ResourceTemplateInfo[];
  name?: string;
}) {
  const name = overrides?.name ?? 'default';
  serverRegistry.register(name, mockServer);
  if (overrides?.resources || overrides?.resourceTemplates) {
    serverRegistry.update(name, {
      resources: overrides.resources ?? [],
      resourceTemplates: overrides.resourceTemplates ?? [],
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

describe('useListResources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns resources and resourceTemplates from registry', () => {
    const resources: ResourceInfo[] = [
      { uri: 'file://readme.md', name: 'README', mimeType: 'text/markdown' },
      { uri: 'app://config', name: 'Config' },
    ];
    const resourceTemplates: ResourceTemplateInfo[] = [
      { uriTemplate: 'file://{path}', name: 'File', description: 'Read any file' },
    ];

    const { result } = renderHook(() => useListResources(), {
      wrapper: createWrapper({ resources, resourceTemplates }),
    });

    expect(result.current.resources).toEqual(resources);
    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resourceTemplates).toEqual(resourceTemplates);
    expect(result.current.resourceTemplates).toHaveLength(1);
  });

  it('returns empty arrays when no resources exist', () => {
    const { result } = renderHook(() => useListResources(), {
      wrapper: createWrapper(),
    });

    expect(result.current.resources).toEqual([]);
    expect(result.current.resourceTemplates).toEqual([]);
  });

  it('returns resources with explicit undefined server option', () => {
    const resources: ResourceInfo[] = [{ uri: 'app://info' }];

    const { result } = renderHook(() => useListResources({ server: undefined }), {
      wrapper: createWrapper({ resources }),
    });

    expect(result.current.resources).toEqual(resources);
  });

  describe('multi-server', () => {
    it('returns resources from named server in registry', () => {
      const remoteResources: ResourceInfo[] = [{ uri: 'remote://data', name: 'Remote Data' }];
      const remoteTemplates: ResourceTemplateInfo[] = [{ uriTemplate: 'remote://{id}', name: 'Remote Item' }];

      serverRegistry.register('data-server', {} as DirectMcpServer);
      serverRegistry.update('data-server', {
        resources: remoteResources,
        resourceTemplates: remoteTemplates,
      });

      const localResources: ResourceInfo[] = [{ uri: 'local://info' }];

      const { result } = renderHook(() => useListResources({ server: 'data-server' }), {
        wrapper: createWrapper({ resources: localResources }),
      });

      expect(result.current.resources).toEqual(remoteResources);
      expect(result.current.resourceTemplates).toEqual(remoteTemplates);
      // Should NOT return context resources
      expect(result.current.resources).not.toContainEqual({ uri: 'local://info' });
    });

    it('returns empty arrays when named server has no resources', () => {
      serverRegistry.register('empty', {} as DirectMcpServer);

      const { result } = renderHook(() => useListResources({ server: 'empty' }), {
        wrapper: createWrapper({ resources: [{ uri: 'local://x' }] }),
      });

      expect(result.current.resources).toEqual([]);
      expect(result.current.resourceTemplates).toEqual([]);
    });

    it('returns empty arrays when named server does not exist', () => {
      const { result } = renderHook(() => useListResources({ server: 'nonexistent' }), {
        wrapper: createWrapper({ resources: [{ uri: 'local://x' }] }),
      });

      expect(result.current.resources).toEqual([]);
      expect(result.current.resourceTemplates).toEqual([]);
    });
  });
});
