import React from 'react';
import { renderHook } from '@testing-library/react';
import { useListPrompts } from '../useListPrompts';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue, PromptInfo } from '../../types';
import type { DirectMcpServer } from '@frontmcp/sdk';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockServer = {} as DirectMcpServer;

function createWrapper(overrides?: { prompts?: PromptInfo[]; name?: string }) {
  const name = overrides?.name ?? 'default';
  serverRegistry.register(name, mockServer);
  if (overrides?.prompts) {
    serverRegistry.update(name, { prompts: overrides.prompts, status: 'connected' });
  }

  const ctx: FrontMcpContextValue = {
    name,
    registry: new ComponentRegistry(),
    dynamicRegistry: new DynamicRegistry(),
    getDynamicRegistry: () => new DynamicRegistry(),
    connect: jest.fn(),
  };
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useListPrompts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverRegistry.clear();
  });

  it('returns prompts from registry', () => {
    const prompts: PromptInfo[] = [
      { name: 'greeting', description: 'Greet the user' },
      {
        name: 'summarize',
        description: 'Summarize text',
        arguments: [
          { name: 'text', description: 'Text to summarize', required: true },
          { name: 'maxLength', description: 'Maximum length' },
        ],
      },
    ];

    const { result } = renderHook(() => useListPrompts(), {
      wrapper: createWrapper({ prompts }),
    });

    expect(result.current).toEqual(prompts);
    expect(result.current).toHaveLength(2);
  });

  it('returns empty array when no prompts exist', () => {
    const { result } = renderHook(() => useListPrompts(), {
      wrapper: createWrapper({ prompts: [] }),
    });

    expect(result.current).toEqual([]);
    expect(result.current).toHaveLength(0);
  });

  it('returns prompts without options argument', () => {
    const prompts: PromptInfo[] = [{ name: 'p1' }];

    const { result } = renderHook(() => useListPrompts(), {
      wrapper: createWrapper({ prompts }),
    });

    expect(result.current).toEqual(prompts);
  });

  it('returns prompts with explicit undefined server option', () => {
    const prompts: PromptInfo[] = [{ name: 'p1' }];

    const { result } = renderHook(() => useListPrompts({ server: undefined }), {
      wrapper: createWrapper({ prompts }),
    });

    expect(result.current).toEqual(prompts);
  });

  describe('multi-server', () => {
    it('returns prompts from named server in registry', () => {
      const remotePrompts: PromptInfo[] = [{ name: 'remote-greeting', description: 'Remote greeting' }];

      serverRegistry.register('ai-server', {} as DirectMcpServer);
      serverRegistry.update('ai-server', { prompts: remotePrompts });

      const localPrompts: PromptInfo[] = [{ name: 'local-prompt' }];

      const { result } = renderHook(() => useListPrompts({ server: 'ai-server' }), {
        wrapper: createWrapper({ prompts: localPrompts }),
      });

      expect(result.current).toEqual(remotePrompts);
      expect(result.current).not.toContainEqual({ name: 'local-prompt' });
    });

    it('returns empty array when named server has no prompts', () => {
      serverRegistry.register('empty', {} as DirectMcpServer);

      const { result } = renderHook(() => useListPrompts({ server: 'empty' }), {
        wrapper: createWrapper({ prompts: [{ name: 'local' }] }),
      });

      expect(result.current).toEqual([]);
    });

    it('returns empty array when named server does not exist', () => {
      const { result } = renderHook(() => useListPrompts({ server: 'nonexistent' }), {
        wrapper: createWrapper({ prompts: [{ name: 'local' }] }),
      });

      expect(result.current).toEqual([]);
    });
  });
});
