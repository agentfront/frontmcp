import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/sdk';

import { ComponentRegistry } from '../../components/ComponentRegistry';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import { useDynamicTool } from '../useDynamicTool';

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

function okResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDynamicTool — Zod schema mode', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  it('registers tool with converted JSON Schema when using zod schema', () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    });

    renderHook(
      () =>
        useDynamicTool({
          name: 'zod_search',
          description: 'Search with zod',
          schema,
          execute: async () => okResult('ok'),
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasTool('zod_search')).toBe(true);

    const tool = dynamicRegistry.findTool('zod_search');
    expect(tool).toBeDefined();
    expect(tool!.description).toBe('Search with zod');
    // The converted JSON Schema should have standard JSON Schema properties
    expect(tool!.inputSchema).toHaveProperty('type', 'object');
    expect(tool!.inputSchema).toHaveProperty('properties');
    const properties = tool!.inputSchema['properties'] as Record<string, unknown>;
    expect(properties).toHaveProperty('query');
    expect(properties).toHaveProperty('limit');
  });

  it('passes validated args to execute callback', async () => {
    const executeFn = jest
      .fn<Promise<CallToolResult>, [{ query: string; limit?: number }]>()
      .mockResolvedValue(okResult('found'));

    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    });

    renderHook(
      () =>
        useDynamicTool({
          name: 'zod_validated',
          description: 'Validated tool',
          schema,
          execute: executeFn,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    const tool = dynamicRegistry.findTool('zod_validated');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ query: 'hello', limit: 10 });

    expect(executeFn).toHaveBeenCalledWith({ query: 'hello', limit: 10 });
    expect(result).toEqual(okResult('found'));
  });

  it('returns validation error on invalid input (wrong type)', async () => {
    const executeFn = jest.fn<Promise<CallToolResult>, [{ count: number }]>().mockResolvedValue(okResult('ok'));

    const schema = z.object({ count: z.number() });

    renderHook(
      () =>
        useDynamicTool({
          name: 'zod_invalid',
          description: 'Expects number',
          schema,
          execute: executeFn,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    const tool = dynamicRegistry.findTool('zod_invalid');
    expect(tool).toBeDefined();

    // Pass a string where a number is expected
    const result = await tool!.execute({ count: 'not-a-number' as unknown as number });

    expect(executeFn).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed.error).toBe('validation_error');
  });

  it('returns validation error with issue details', async () => {
    const executeFn = jest
      .fn<Promise<CallToolResult>, [{ name: string; age: number }]>()
      .mockResolvedValue(okResult('ok'));

    const schema = z.object({
      name: z.string(),
      age: z.number().min(0),
    });

    renderHook(
      () =>
        useDynamicTool({
          name: 'zod_issues',
          description: 'With issue details',
          schema,
          execute: executeFn,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    const tool = dynamicRegistry.findTool('zod_issues');
    expect(tool).toBeDefined();

    // Pass completely wrong types
    const result = await tool!.execute({ name: 123 as unknown, age: 'old' as unknown } as Record<string, unknown>);

    expect(executeFn).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);

    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    expect(parsed.error).toBe('validation_error');
    expect(parsed.issues).toBeDefined();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBeGreaterThanOrEqual(1);

    // Each issue should have path and message
    for (const issue of parsed.issues) {
      expect(issue).toHaveProperty('path');
      expect(issue).toHaveProperty('message');
    }
  });

  it('JSON Schema backward compat: registers tool with raw inputSchema', async () => {
    const executeFn = jest
      .fn<Promise<CallToolResult>, [Record<string, unknown>]>()
      .mockResolvedValue(okResult('legacy'));

    const inputSchema = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    };

    renderHook(
      () =>
        useDynamicTool({
          name: 'json_schema_tool',
          description: 'Legacy JSON Schema tool',
          inputSchema,
          execute: executeFn,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasTool('json_schema_tool')).toBe(true);

    const tool = dynamicRegistry.findTool('json_schema_tool');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema).toEqual(inputSchema);

    // Execute should pass args directly without validation
    const result = await tool!.execute({ q: 'test' });
    expect(executeFn).toHaveBeenCalledWith({ q: 'test' });
    expect(result).toEqual(okResult('legacy'));
  });

  it('does not register tool when disabled', () => {
    const schema = z.object({ x: z.string() });

    renderHook(
      () =>
        useDynamicTool({
          name: 'disabled_tool',
          description: 'Should not register',
          schema,
          execute: async () => okResult('nope'),
          enabled: false,
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasTool('disabled_tool')).toBe(false);
  });

  it('unregisters tool on unmount', () => {
    const schema = z.object({ data: z.string() });

    const { unmount } = renderHook(
      () =>
        useDynamicTool({
          name: 'unmount_tool',
          description: 'Will be removed',
          schema,
          execute: async () => okResult('ok'),
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasTool('unmount_tool')).toBe(true);

    unmount();

    expect(dynamicRegistry.hasTool('unmount_tool')).toBe(false);
  });

  it('re-registers tool when schema changes', () => {
    const schemaV1 = z.object({ q: z.string() });
    const schemaV2 = z.object({ q: z.string(), page: z.number() });

    let activeSchema = schemaV1;

    const { rerender } = renderHook(
      () =>
        useDynamicTool({
          name: 'reregister_tool',
          description: 'Re-registers on schema change',
          schema: activeSchema,
          execute: async () => okResult('ok'),
        }),
      { wrapper: createWrapper(dynamicRegistry) },
    );

    expect(dynamicRegistry.hasTool('reregister_tool')).toBe(true);
    const toolV1 = dynamicRegistry.findTool('reregister_tool');
    const propsV1 = toolV1!.inputSchema['properties'] as Record<string, unknown>;
    expect(propsV1).toHaveProperty('q');
    expect(propsV1).not.toHaveProperty('page');

    // Change schema and re-render
    activeSchema = schemaV2;
    rerender();

    expect(dynamicRegistry.hasTool('reregister_tool')).toBe(true);
    const toolV2 = dynamicRegistry.findTool('reregister_tool');
    const propsV2 = toolV2!.inputSchema['properties'] as Record<string, unknown>;
    expect(propsV2).toHaveProperty('q');
    expect(propsV2).toHaveProperty('page');
  });

  it('does not re-register on every render when the schema is written inline', () => {
    const registerSpy = jest.spyOn(dynamicRegistry, 'registerTool');
    let renders = 0;

    const { rerender } = renderHook(
      () => {
        renders++;
        // Reading registry state makes the component re-render whenever the registry notifies
        React.useSyncExternalStore(
          (l) => dynamicRegistry.subscribe(l),
          () => dynamicRegistry.getVersion(),
        );
        useDynamicTool({
          name: 'inline_schema',
          description: 'inline',
          schema: z.object({ q: z.string() }),
          execute: async () => okResult('ok'),
        });
      },
      { wrapper: createWrapper(dynamicRegistry) },
    );

    rerender();
    rerender();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(renders).toBeLessThan(8);
  });

  it('re-registers when the schema content changes', () => {
    const registerSpy = jest.spyOn(dynamicRegistry, 'registerTool');
    const { rerender } = renderHook(
      ({ field }: { field: string }) =>
        useDynamicTool({
          name: 'changing_schema',
          description: 'changing',
          inputSchema: { type: 'object', properties: { [field]: { type: 'string' } } },
          execute: async () => okResult('ok'),
        }),
      { wrapper: createWrapper(dynamicRegistry), initialProps: { field: 'a' } },
    );
    rerender({ field: 'b' });
    expect(registerSpy).toHaveBeenCalledTimes(2);
  });

  it('runs the execute of the latest committed render without registering again', async () => {
    const registerSpy = jest.spyOn(dynamicRegistry, 'registerTool');
    const { rerender } = renderHook(
      ({ label }: { label: string }) =>
        useDynamicTool({
          name: 'labelled',
          description: 'labelled',
          inputSchema: { type: 'object' },
          execute: async () => okResult(label),
        }),
      { wrapper: createWrapper(dynamicRegistry), initialProps: { label: 'first' } },
    );

    rerender({ label: 'second' });
    const result = await dynamicRegistry.findTool('labelled')?.execute({});

    expect(result).toEqual(okResult('second'));
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('runs the committed execute and schema while a newer render is suspended', async () => {
    const committedExecute = jest.fn(async () => okResult('committed'));
    const discardedExecute = jest.fn(async () => okResult('discarded'));
    const neverSettles = new Promise<never>(() => undefined);
    function SearchTool({ committed }: { committed: boolean }) {
      useDynamicTool({
        name: 'search',
        description: 'Search',
        schema: z.object({ query: committed ? z.string() : z.string().min(100) }),
        execute: committed ? committedExecute : discardedExecute,
      });
      if (!committed) throw neverSettles;
      return null;
    }
    const Wrapper = createWrapper(dynamicRegistry);
    const tree = (committed: boolean) => (
      <Wrapper>
        <React.Suspense fallback={null}>
          <SearchTool committed={committed} />
        </React.Suspense>
      </Wrapper>
    );
    const { rerender } = render(tree(true));

    await act(async () => {
      React.startTransition(() => rerender(tree(false)));
    });
    const result = await dynamicRegistry.findTool('search')?.execute({ query: 'mcp' });

    expect(result).toEqual(okResult('committed'));
    expect(committedExecute).toHaveBeenCalledWith({ query: 'mcp' });
    expect(discardedExecute).not.toHaveBeenCalled();
  });
});
