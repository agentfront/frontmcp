import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { AgentSearch } from '../AgentSearch';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { ComponentRegistry } from '../ComponentRegistry';
import type { FrontMcpContextValue } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentSearch', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  describe('default input rendering', () => {
    it('renders a default text input', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const { container } = render(
        React.createElement(AgentSearch, {
          toolName: 'search',
          description: 'Search tool',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const input = container.querySelector('input');
      expect(input).toBeTruthy();
      expect(input!.type).toBe('text');
      expect(input!.value).toBe('');
    });

    it('renders input with placeholder', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const { container } = render(
        React.createElement(AgentSearch, {
          toolName: 'search',
          description: 'Search tool',
          placeholder: 'Type to search...',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const input = container.querySelector('input');
      expect(input).toBeTruthy();
      expect(input!.placeholder).toBe('Type to search...');
    });

    it('updates input value on change', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const { container } = render(
        React.createElement(AgentSearch, {
          toolName: 'search',
          description: 'Search tool',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const input = container.querySelector('input')!;

      act(() => {
        fireEvent.change(input, { target: { value: 'hello' } });
      });

      expect(input.value).toBe('hello');
    });
  });

  describe('custom renderInput', () => {
    it('uses custom renderInput when provided', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const customRenderInput = (props: { value: string; onChange: (v: string) => void; placeholder?: string }) =>
        React.createElement('textarea', {
          'data-testid': 'custom-input',
          value: props.value,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value),
          placeholder: props.placeholder,
        });

      const { getByTestId, container } = render(
        React.createElement(AgentSearch, {
          toolName: 'search',
          description: 'Search tool',
          placeholder: 'Custom placeholder',
          renderInput: customRenderInput,
          onResults,
        }),
        { wrapper: Wrapper },
      );

      // Should use custom input, not default <input>
      expect(container.querySelector('input')).toBeNull();
      const textarea = getByTestId('custom-input');
      expect(textarea).toBeTruthy();
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('passes placeholder to custom renderInput', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const customRenderInput = (props: { value: string; onChange: (v: string) => void; placeholder?: string }) =>
        React.createElement('input', {
          'data-testid': 'custom',
          placeholder: props.placeholder,
          value: props.value,
          onChange: () => {},
        });

      const { getByTestId } = render(
        React.createElement(AgentSearch, {
          toolName: 'search',
          description: 'Search',
          placeholder: 'My placeholder',
          renderInput: customRenderInput,
          onResults,
        }),
        { wrapper: Wrapper },
      );

      expect((getByTestId('custom') as HTMLInputElement).placeholder).toBe('My placeholder');
    });
  });

  describe('dynamic tool registration', () => {
    it('registers a tool in the dynamic registry', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'product-search',
          description: 'Search products',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      expect(dynamicRegistry.hasTool('product-search')).toBe(true);
      const tool = dynamicRegistry.findTool('product-search');
      expect(tool).toBeDefined();
      expect(tool!.description).toBe('Search products');
      expect(tool!.inputSchema).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          results: { type: 'array', description: 'Search results to display' },
        },
      });
    });

    it('calls onResults when the tool execute is invoked with results', async () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'search-tool',
          description: 'Search',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const tool = dynamicRegistry.findTool('search-tool')!;
      expect(tool).toBeDefined();

      const searchResults = [
        { id: 1, name: 'Result 1' },
        { id: 2, name: 'Result 2' },
      ];

      let result: unknown;
      await act(async () => {
        result = await tool.execute({ results: searchResults });
      });

      expect(onResults).toHaveBeenCalledWith(searchResults);
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ success: true, delivered: true }) }],
      });
    });

    it('falls back to full args when results key is not present', async () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'search-tool',
          description: 'Search',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const tool = dynamicRegistry.findTool('search-tool')!;

      await act(async () => {
        await tool.execute({ query: 'test query', other: 'data' });
      });

      // When no results key, the entire args object is passed
      expect(onResults).toHaveBeenCalledWith({ query: 'test query', other: 'data' });
    });
  });

  describe('dynamic resource registration', () => {
    it('registers a resource in the dynamic registry', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'doc-search',
          description: 'Search docs',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const uri = 'search://doc-search/query';
      expect(dynamicRegistry.hasResource(uri)).toBe(true);
      const resource = dynamicRegistry.findResource(uri);
      expect(resource).toBeDefined();
      expect(resource!.name).toBe('doc-search-query');
      expect(resource!.mimeType).toBe('text/plain');
    });

    it('resource reads the current query value', async () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const { container } = render(
        React.createElement(AgentSearch, {
          toolName: 'query-read',
          description: 'Read query test',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      // Read query before any input — should be empty
      const resource = dynamicRegistry.findResource('search://query-read/query')!;
      expect(resource).toBeDefined();

      const initialResult = await resource.read();
      expect(initialResult.contents).toEqual([{ uri: 'search://query-read/query', mimeType: 'text/plain', text: '' }]);

      // Type into the input to update query
      const input = container.querySelector('input')!;
      act(() => {
        fireEvent.change(input, { target: { value: 'react hooks' } });
      });

      // Read again — the read function uses ref so it picks up latest state
      // The resource read function is updated via useDynamicResource's stableRead pattern
      const updatedResult = await resource.read();
      expect(updatedResult.contents).toEqual([
        { uri: 'search://query-read/query', mimeType: 'text/plain', text: 'react hooks' },
      ]);
    });
  });

  describe('cleanup on unmount', () => {
    it('unregisters both tool and resource from registry on unmount', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      const { unmount } = render(
        React.createElement(AgentSearch, {
          toolName: 'cleanup-search',
          description: 'Cleanup test',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      // Both should be registered
      expect(dynamicRegistry.hasTool('cleanup-search')).toBe(true);
      expect(dynamicRegistry.hasResource('search://cleanup-search/query')).toBe(true);

      unmount();

      // Both should be removed
      expect(dynamicRegistry.hasTool('cleanup-search')).toBe(false);
      expect(dynamicRegistry.hasResource('search://cleanup-search/query')).toBe(false);
    });
  });

  describe('tool execute return value', () => {
    it('returns success response from tool execute', async () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'return-test',
          description: 'Return value test',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const tool = dynamicRegistry.findTool('return-test')!;
      let result: unknown;

      await act(async () => {
        result = await tool.execute({ results: ['item1'] });
      });

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.delivered).toBe(true);
    });
  });

  describe('resource description', () => {
    it('includes toolName in the resource description', () => {
      const onResults = jest.fn();
      const Wrapper = createWrapper(dynamicRegistry);

      render(
        React.createElement(AgentSearch, {
          toolName: 'desc-test',
          description: 'Description test',
          onResults,
        }),
        { wrapper: Wrapper },
      );

      const resource = dynamicRegistry.findResource('search://desc-test/query');
      expect(resource).toBeDefined();
      expect(resource!.description).toBe('Current search query for desc-test');
    });
  });
});
