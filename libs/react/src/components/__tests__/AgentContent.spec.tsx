import React from 'react';
import { render, act } from '@testing-library/react';
import { AgentContent } from '../AgentContent';
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

describe('AgentContent', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  it('renders fallback before agent calls the tool', () => {
    const renderFn = jest.fn((data: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rendered' }, JSON.stringify(data)),
    );
    const fallback = React.createElement('span', { 'data-testid': 'fallback' }, 'Loading...');

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, queryByTestId } = render(
      React.createElement(AgentContent, {
        name: 'test-tool',
        description: 'A test tool',
        render: renderFn,
        fallback,
      }),
      { wrapper: Wrapper },
    );

    expect(getByTestId('fallback')).toBeTruthy();
    expect(getByTestId('fallback').textContent).toBe('Loading...');
    expect(queryByTestId('rendered')).toBeNull();
    expect(renderFn).not.toHaveBeenCalled();
  });

  it('renders null fallback by default', () => {
    const renderFn = jest.fn(() => React.createElement('div', null, 'content'));

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(
      React.createElement(AgentContent, {
        name: 'test-tool',
        description: 'A test tool',
        render: renderFn,
      }),
      { wrapper: Wrapper },
    );

    expect(container.innerHTML).toBe('');
    expect(renderFn).not.toHaveBeenCalled();
  });

  it('registers the tool in the dynamic registry on mount', () => {
    const Wrapper = createWrapper(dynamicRegistry);

    render(
      React.createElement(AgentContent, {
        name: 'my-content-tool',
        description: 'Renders content',
        render: () => React.createElement('div', null, 'hello'),
      }),
      { wrapper: Wrapper },
    );

    expect(dynamicRegistry.hasTool('my-content-tool')).toBe(true);
    const tool = dynamicRegistry.findTool('my-content-tool');
    expect(tool).toBeDefined();
    expect(tool!.description).toBe('Renders content');
  });

  it('registers the tool with default inputSchema when none provided', () => {
    const Wrapper = createWrapper(dynamicRegistry);

    render(
      React.createElement(AgentContent, {
        name: 'schema-tool',
        description: 'Default schema test',
        render: () => React.createElement('div', null, 'test'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('schema-tool');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toEqual({ type: 'object' });
  });

  it('registers the tool with custom inputSchema when provided', () => {
    const Wrapper = createWrapper(dynamicRegistry);
    const customSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    };

    render(
      React.createElement(AgentContent, {
        name: 'custom-schema-tool',
        description: 'Custom schema test',
        inputSchema: customSchema,
        render: () => React.createElement('div', null, 'test'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('custom-schema-tool');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toEqual(customSchema);
  });

  it('renders content after agent calls the tool via execute', async () => {
    const renderFn = (data: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rendered' }, `Title: ${data.title}`);
    const fallback = React.createElement('span', { 'data-testid': 'fallback' }, 'Loading...');

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, queryByTestId } = render(
      React.createElement(AgentContent, {
        name: 'content-tool',
        description: 'Display content',
        render: renderFn,
        fallback,
      }),
      { wrapper: Wrapper },
    );

    // Fallback should be visible initially
    expect(getByTestId('fallback')).toBeTruthy();

    // Simulate agent calling the tool
    const tool = dynamicRegistry.findTool('content-tool')!;
    expect(tool).toBeDefined();

    await act(async () => {
      const result = await tool.execute({ title: 'Hello World' });
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify({ success: true, rendered: 'content-tool' }) },
      ]);
    });

    // Rendered content should now be visible, fallback gone
    expect(getByTestId('rendered')).toBeTruthy();
    expect(getByTestId('rendered').textContent).toBe('Title: Hello World');
    expect(queryByTestId('fallback')).toBeNull();
  });

  it('updates render when agent calls tool multiple times', async () => {
    const renderFn = (data: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rendered' }, `Count: ${data.count}`);

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(
      React.createElement(AgentContent, {
        name: 'counter-tool',
        description: 'Counter display',
        render: renderFn,
        fallback: React.createElement('span', null, 'waiting'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('counter-tool')!;

    // First call
    await act(async () => {
      await tool.execute({ count: 1 });
    });
    expect(getByTestId('rendered').textContent).toBe('Count: 1');

    // Second call
    await act(async () => {
      await tool.execute({ count: 42 });
    });
    expect(getByTestId('rendered').textContent).toBe('Count: 42');

    // Third call
    await act(async () => {
      await tool.execute({ count: 100 });
    });
    expect(getByTestId('rendered').textContent).toBe('Count: 100');
  });

  it('returns proper CallToolResult from execute', async () => {
    const Wrapper = createWrapper(dynamicRegistry);

    render(
      React.createElement(AgentContent, {
        name: 'result-tool',
        description: 'Test result',
        render: () => React.createElement('div', null, 'ok'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('result-tool')!;

    let result: unknown;
    await act(async () => {
      result = await tool.execute({ foo: 'bar' });
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, rendered: 'result-tool' }) }],
    });
  });

  it('unregisters the tool from the registry on unmount', () => {
    const Wrapper = createWrapper(dynamicRegistry);

    const { unmount } = render(
      React.createElement(AgentContent, {
        name: 'cleanup-tool',
        description: 'Will be removed',
        render: () => React.createElement('div', null, 'content'),
      }),
      { wrapper: Wrapper },
    );

    expect(dynamicRegistry.hasTool('cleanup-tool')).toBe(true);

    unmount();

    expect(dynamicRegistry.hasTool('cleanup-tool')).toBe(false);
  });

  it('passes empty args through render when execute is called with empty object', async () => {
    const renderFn = jest.fn((data: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rendered' }, Object.keys(data).length.toString()),
    );

    const Wrapper = createWrapper(dynamicRegistry);
    render(
      React.createElement(AgentContent, {
        name: 'empty-args-tool',
        description: 'Empty args test',
        render: renderFn,
        fallback: React.createElement('span', null, 'loading'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('empty-args-tool')!;

    await act(async () => {
      await tool.execute({});
    });

    expect(renderFn).toHaveBeenCalledWith({});
  });

  it('includes tool name in the execute result', async () => {
    const Wrapper = createWrapper(dynamicRegistry);

    render(
      React.createElement(AgentContent, {
        name: 'named-tool',
        description: 'Named tool test',
        render: () => React.createElement('div', null, 'ok'),
      }),
      { wrapper: Wrapper },
    );

    const tool = dynamicRegistry.findTool('named-tool')!;

    let result: unknown;
    await act(async () => {
      result = await tool.execute({ data: 'test' });
    });

    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.rendered).toBe('named-tool');
    expect(parsed.success).toBe(true);
  });
});
