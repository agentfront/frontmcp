import { act, render } from '@testing-library/react';
import React from 'react';

import { z } from '@frontmcp/lazy-zod';

import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import { ComponentRegistry } from '../ComponentRegistry';
import { mcpComponent, mcpLazy } from '../mcpComponent';

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

function TestCard(props: { city: string; temp: number }) {
  return React.createElement('div', { 'data-testid': 'card' }, `${props.city}: ${props.temp}`);
}

const testSchema = z.object({
  city: z.string(),
  temp: z.number(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mcpComponent', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  it('renders fallback before agent invokes the tool', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'weather-card',
      schema: testSchema,
      fallback: React.createElement('span', { 'data-testid': 'fallback' }, 'Loading...'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, queryByTestId } = render(React.createElement(WeatherCard), { wrapper: Wrapper });

    expect(getByTestId('fallback')).toBeTruthy();
    expect(getByTestId('fallback').textContent).toBe('Loading...');
    expect(queryByTestId('card')).toBeNull();
  });

  it('registers tool in DynamicRegistry on mount', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'weather-tool',
      description: 'Shows weather',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    render(React.createElement(WeatherCard), { wrapper: Wrapper });

    expect(dynamicRegistry.hasTool('weather-tool')).toBe(true);
    const tool = dynamicRegistry.findTool('weather-tool');
    expect(tool).toBeDefined();
    expect(tool!.description).toBe('Shows weather');
  });

  it('has correct .toolName static property', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'my-weather',
      schema: testSchema,
    });

    expect(WeatherCard.toolName).toBe('my-weather');
  });

  it('has correct .displayName', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'city-weather',
      schema: testSchema,
    });

    expect(WeatherCard.displayName).toBe('mcpComponent(city-weather)');
  });

  it('agent calling the tool triggers rendering of the wrapped component', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'render-test',
      schema: testSchema,
      fallback: React.createElement('span', { 'data-testid': 'fallback' }, 'Waiting'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, queryByTestId } = render(React.createElement(WeatherCard), { wrapper: Wrapper });

    expect(getByTestId('fallback')).toBeTruthy();

    const tool = dynamicRegistry.findTool('render-test')!;
    expect(tool).toBeDefined();

    await act(async () => {
      await tool.execute({ city: 'Paris', temp: 22 });
    });

    expect(getByTestId('card')).toBeTruthy();
    expect(getByTestId('card').textContent).toBe('Paris: 22');
    expect(queryByTestId('fallback')).toBeNull();
  });

  it('validates agent data against zod schema (success path)', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'valid-data',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    render(React.createElement(WeatherCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('valid-data')!;

    let result: unknown;
    await act(async () => {
      result = await tool.execute({ city: 'Berlin', temp: 15 });
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, rendered: 'valid-data' }) }],
    });
  });

  it('returns validation error CallToolResult on bad data', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'bad-data',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    render(React.createElement(WeatherCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('bad-data')!;

    let result: { isError?: boolean; content: Array<{ type: string; text: string }> };
    await act(async () => {
      result = (await tool.execute({ city: 123, temp: 'not-a-number' })) as typeof result;
    });

    expect(result!.isError).toBe(true);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error).toBe('validation_error');
    expect(parsed.issues).toBeDefined();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it('updates render when agent calls tool multiple times', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'multi-call',
      schema: testSchema,
      fallback: React.createElement('span', null, 'waiting'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(WeatherCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('multi-call')!;

    await act(async () => {
      await tool.execute({ city: 'Tokyo', temp: 30 });
    });
    expect(getByTestId('card').textContent).toBe('Tokyo: 30');

    await act(async () => {
      await tool.execute({ city: 'London', temp: 12 });
    });
    expect(getByTestId('card').textContent).toBe('London: 12');

    await act(async () => {
      await tool.execute({ city: 'NYC', temp: 25 });
    });
    expect(getByTestId('card').textContent).toBe('NYC: 25');
  });

  it('unregisters tool on unmount', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'unmount-tool',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { unmount } = render(React.createElement(WeatherCard), { wrapper: Wrapper });

    expect(dynamicRegistry.hasTool('unmount-tool')).toBe(true);

    unmount();

    expect(dynamicRegistry.hasTool('unmount-tool')).toBe(false);
  });

  it('direct props merge with agent data', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'merge-props',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(WeatherCard, { city: 'Default' }), { wrapper: Wrapper });

    // Agent provides data; direct prop city should override agent city
    const tool = dynamicRegistry.findTool('merge-props')!;
    await act(async () => {
      await tool.execute({ city: 'AgentCity', temp: 10 });
    });

    // Direct props override agent data (spread order: { ...lastData, ...directProps })
    expect(getByTestId('card').textContent).toBe('Default: 10');
  });

  it('direct props alone render without agent data', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'direct-only',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, queryByTestId } = render(React.createElement(WeatherCard, { city: 'Oslo', temp: -5 }), {
      wrapper: Wrapper,
    });

    expect(getByTestId('card')).toBeTruthy();
    expect(getByTestId('card').textContent).toBe('Oslo: -5');
    expect(queryByTestId('fallback')).toBeNull();
  });

  it('table mode: registers tool and renders <table> when columns provided', async () => {
    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age' },
    ];
    const rowSchema = z.object({ name: z.string(), age: z.number() });

    const DataTable = mcpComponent(null, {
      name: 'data-table',
      description: 'Show data table',
      schema: rowSchema,
      columns,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(React.createElement(DataTable), { wrapper: Wrapper });

    expect(dynamicRegistry.hasTool('data-table')).toBe(true);

    const tool = dynamicRegistry.findTool('data-table')!;
    await act(async () => {
      await tool.execute({ rows: [{ name: 'Alice', age: 30 }] });
    });

    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });

  it('table mode: renders fallback before data', () => {
    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'value', header: 'Value' },
    ];
    const rowSchema = z.object({ id: z.number(), value: z.string() });

    const DataTable = mcpComponent(null, {
      name: 'table-fallback',
      schema: rowSchema,
      columns,
      fallback: React.createElement('span', { 'data-testid': 'table-loading' }, 'Loading table...'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId, container } = render(React.createElement(DataTable), { wrapper: Wrapper });

    expect(getByTestId('table-loading')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('table mode: renders rows from agent data', async () => {
    const columns = [
      { key: 'fruit', header: 'Fruit' },
      { key: 'count', header: 'Count' },
    ];
    const rowSchema = z.object({ fruit: z.string(), count: z.number() });

    const FruitTable = mcpComponent(null, {
      name: 'fruit-table',
      schema: rowSchema,
      columns,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(React.createElement(FruitTable), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('fruit-table')!;
    await act(async () => {
      await tool.execute({
        rows: [
          { fruit: 'Apple', count: 5 },
          { fruit: 'Banana', count: 3 },
        ],
      });
    });

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    const cells = container.querySelectorAll('tbody td');
    expect(cells[0].textContent).toBe('Apple');
    expect(cells[1].textContent).toBe('5');
    expect(cells[2].textContent).toBe('Banana');
    expect(cells[3].textContent).toBe('3');
  });

  it('table mode: uses custom render in column def', async () => {
    const columns = [
      { key: 'name', header: 'Name' },
      {
        key: 'score',
        header: 'Score',
        render: (value: unknown) => React.createElement('strong', null, `Score: ${value}`),
      },
    ];
    const rowSchema = z.object({ name: z.string(), score: z.number() });

    const ScoreTable = mcpComponent(null, {
      name: 'score-table',
      schema: rowSchema,
      columns,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(React.createElement(ScoreTable), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('score-table')!;
    await act(async () => {
      await tool.execute({ rows: [{ name: 'Alice', score: 95 }] });
    });

    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe('Score: 95');
  });

  it('table mode: renders correct headers', async () => {
    const columns = [
      { key: 'city', header: 'City' },
      { key: 'pop', header: 'Population' },
    ];
    const rowSchema = z.object({ city: z.string(), pop: z.number() });

    const CityTable = mcpComponent(null, {
      name: 'city-table',
      schema: rowSchema,
      columns,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(React.createElement(CityTable), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('city-table')!;
    await act(async () => {
      await tool.execute({ rows: [{ city: 'Rome', pop: 2800000 }] });
    });

    const headers = container.querySelectorAll('thead th');
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toBe('City');
    expect(headers[1].textContent).toBe('Population');
  });

  it('tool description defaults to name when not provided', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'no-desc-tool',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    render(React.createElement(WeatherCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('no-desc-tool');
    expect(tool).toBeDefined();
    expect(tool!.description).toBe('no-desc-tool');
  });

  it('works with inline function component', async () => {
    const InlineCard = mcpComponent(
      (props: { label: string }) => React.createElement('span', { 'data-testid': 'inline' }, props.label),
      {
        name: 'inline-tool',
        schema: z.object({ label: z.string() }),
      },
    );

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(InlineCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('inline-tool')!;
    await act(async () => {
      await tool.execute({ label: 'Hello Inline' });
    });

    expect(getByTestId('inline').textContent).toBe('Hello Inline');
  });

  it('shows fallback with null component and no columns (edge case)', () => {
    const NullComponent = mcpComponent(null, {
      name: 'null-component',
      schema: testSchema,
      fallback: React.createElement('span', { 'data-testid': 'null-fallback' }, 'No component'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(NullComponent), { wrapper: Wrapper });

    expect(getByTestId('null-fallback')).toBeTruthy();
    expect(getByTestId('null-fallback').textContent).toBe('No component');
  });

  it('renders null fallback by default when no fallback is provided', () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'no-fallback',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { container } = render(React.createElement(WeatherCard), { wrapper: Wrapper });

    expect(container.innerHTML).toBe('');
  });

  it('mcpLazy brands a factory so isLazyImport detects it', async () => {
    function LazyCard(props: { msg: string }) {
      return React.createElement('span', { 'data-testid': 'lazy-card' }, props.msg);
    }

    const factory = mcpLazy(() => Promise.resolve({ default: LazyCard }));

    const LazyComponent = mcpComponent(factory, {
      name: 'lazy-test',
      schema: z.object({ msg: z.string() }),
      fallback: React.createElement('span', { 'data-testid': 'lazy-fallback' }, 'Loading...'),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(LazyComponent), { wrapper: Wrapper });

    expect(getByTestId('lazy-fallback')).toBeTruthy();

    const tool = dynamicRegistry.findTool('lazy-test')!;
    expect(tool).toBeDefined();

    await act(async () => {
      await tool.execute({ msg: 'Hello Lazy' });
    });

    // After Suspense resolves, the lazy card should appear
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(getByTestId('lazy-card').textContent).toBe('Hello Lazy');
  });

  it('zero-arg function component is NOT treated as lazy without mcpLazy', () => {
    const ZeroArgComponent = () => React.createElement('span', { 'data-testid': 'zero-arg' }, 'I am not lazy');

    const Comp = mcpComponent(ZeroArgComponent, {
      name: 'zero-arg-test',
      schema: z.object({ label: z.string() }),
    });

    const Wrapper = createWrapper(dynamicRegistry);
    const { getByTestId } = render(React.createElement(Comp, { label: 'test' }), { wrapper: Wrapper });

    // Should render directly (not via Suspense), so the text should appear
    expect(getByTestId('zero-arg').textContent).toBe('I am not lazy');
  });

  it('returns success CallToolResult from execute', async () => {
    const WeatherCard = mcpComponent(TestCard, {
      name: 'result-check',
      schema: testSchema,
    });

    const Wrapper = createWrapper(dynamicRegistry);
    render(React.createElement(WeatherCard), { wrapper: Wrapper });

    const tool = dynamicRegistry.findTool('result-check')!;

    let result: unknown;
    await act(async () => {
      result = await tool.execute({ city: 'Rome', temp: 28 });
    });

    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.rendered).toBe('result-check');
  });
});
