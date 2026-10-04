import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult, DirectClient, DirectMcpServer, RuntimeToolDefinition } from '@frontmcp/sdk';

import { useDynamicTool } from '../../hooks/useDynamicTool';
import { useFrontMcp } from '../../hooks/useFrontMcp';
import type { DynamicRegistry } from '../../registry/DynamicRegistry';
import { serverRegistry } from '../../registry/ServerRegistry';
import { FrontMcpContext } from '../FrontMcpContext';
import { FrontMcpProvider } from '../FrontMcpProvider';

/**
 * The provider registers the tools components register with the server (`server.registerTool()`),
 * and follows the server's `notifications/tools/list_changed` for the listing. A real server's side
 * of this is covered by `bindDynamicTools.spec.ts`; here a server double records the registrations.
 */

type Notification = { method: string; params?: unknown };

/** A server double: registered tools are listed and announced like a real server does. */
function serverDouble(baseTools: string[] = ['static_tool']) {
  const registered = new Map<string, RuntimeToolDefinition>();
  const handlers = new Set<(notification: Notification) => void>();
  const announce = () => {
    for (const handler of handlers) handler({ method: 'notifications/tools/list_changed' });
  };
  const listing = () => [
    ...baseTools.map((name) => ({ name })),
    ...[...registered.values()].map(({ name }) => ({ name })),
  ];
  const client = {
    listTools: jest.fn(async () => listing()),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    onResourceUpdated: jest.fn().mockReturnValue(() => undefined),
    onNotification: jest.fn((handler: (notification: Notification) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
  } as unknown as DirectClient;
  const unregisters = new Map<string, jest.Mock>();
  const server = {
    connect: jest.fn().mockResolvedValue(client),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    registerTool: jest.fn(async (definition: RuntimeToolDefinition) => {
      if (baseTools.includes(definition.name) || registered.has(definition.name)) {
        throw new Error(`A tool named "${definition.name}" is already registered`);
      }
      registered.set(definition.name, definition);
      announce();
      const unregister = jest.fn(() => {
        registered.delete(definition.name);
        announce();
      });
      unregisters.set(definition.name, unregister);
      return unregister;
    }),
  } as unknown as DirectMcpServer;
  return { server, registered, unregisters };
}

function AddTool({ name = 'add', server, app }: { name?: string; server?: string; app?: string }) {
  useDynamicTool({
    name,
    description: 'Adds two numbers',
    schema: z.object({ a: z.number(), b: z.number() }),
    annotations: { readOnlyHint: true },
    availableWhen: { surface: ['webmcp'] },
    server,
    app,
    execute: async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
  });
  return null;
}

function ToolNames({ onTools }: { onTools: (names: string[]) => void }) {
  const { tools } = useFrontMcp();
  React.useEffect(() => {
    onTools(tools.map((tool) => tool.name));
  });
  return null;
}

const signal = new AbortController().signal;

describe('FrontMcpProvider dynamic tools', () => {
  beforeEach(() => {
    serverRegistry.clear();
  });

  it('registers a component tool with the server, lists it, and removes it on unmount', async () => {
    const { server, registered, unregisters } = serverDouble();
    let names: string[] = [];
    const tree = (withTool: boolean) =>
      React.createElement(
        FrontMcpProvider,
        { server },
        withTool ? React.createElement(AddTool) : null,
        React.createElement(ToolNames, { onTools: (next: string[]) => (names = next) }),
      );

    const view = render(tree(true));
    await waitFor(() => expect(names).toEqual(['static_tool', 'add']));

    expect(registered.get('add')).toEqual(
      expect.objectContaining({
        name: 'add',
        description: 'Adds two numbers',
        annotations: { readOnlyHint: true },
        availableWhen: { surface: ['webmcp'] },
        inputSchema: expect.objectContaining({ type: 'object' }),
      }),
    );
    const result = (await registered.get('add')?.execute({ a: 2, b: 3 }, { signal })) as CallToolResult;
    expect(result.content).toEqual([{ type: 'text', text: '5' }]);

    await act(async () => {
      view.rerender(tree(false));
    });
    await waitFor(() => expect(names).toEqual(['static_tool']));
    expect(unregisters.get('add')).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("validates arguments against the component's zod schema", async () => {
    const { server, registered } = serverDouble();
    const view = render(React.createElement(FrontMcpProvider, { server }, React.createElement(AddTool)));
    await waitFor(() => expect(registered.has('add')).toBe(true));

    const result = (await registered.get('add')?.execute({ a: 'two', b: 3 }, { signal })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('validation_error');
    view.unmount();
  });

  it('reports a tool the server refuses through onError', async () => {
    const { server } = serverDouble();
    const onError = jest.fn();

    const view = render(
      React.createElement(
        FrontMcpProvider,
        { server, onError, autoConnect: false },
        React.createElement(AddTool, { name: 'static_tool' }),
      ),
    );

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0][0] as Error).message).toBe(
      'Dynamic tool "static_tool" was not registered: A tool named "static_tool" is already registered',
    );
    view.unmount();
  });

  it('reports through the committed onError while a newer render is suspended', async () => {
    const { server } = serverDouble();
    const committedOnError = jest.fn();
    const discardedOnError = jest.fn();
    const neverSettles = new Promise<never>(() => undefined);
    let dynamicRegistry: DynamicRegistry | undefined;
    function RegistryProbe() {
      const context = React.useContext(FrontMcpContext);
      React.useEffect(() => {
        dynamicRegistry = context.dynamicRegistry;
      }, [context.dynamicRegistry]);
      return null;
    }
    function Suspender({ suspend }: { suspend: boolean }) {
      if (suspend) throw neverSettles;
      return null;
    }
    const tree = (onError: jest.Mock, suspend: boolean) => (
      <FrontMcpProvider server={server} onError={onError} autoConnect={false}>
        <RegistryProbe />
        <React.Suspense fallback={null}>
          <Suspender suspend={suspend} />
        </React.Suspense>
      </FrontMcpProvider>
    );
    const view = render(tree(committedOnError, false));

    await act(async () => {
      React.startTransition(() => view.rerender(tree(discardedOnError, true)));
    });
    dynamicRegistry?.registerTool({
      name: 'static_tool',
      description: 'Clashes with a server tool',
      inputSchema: { type: 'object' },
      execute: async () => ({ content: [] }),
    });

    await waitFor(() => expect(committedOnError).toHaveBeenCalledTimes(1));
    expect(discardedOnError).not.toHaveBeenCalled();
    view.unmount();
  });

  it('warns on the console about a refused tool when no onError is given', async () => {
    const { server } = serverDouble();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const view = render(
      React.createElement(
        FrontMcpProvider,
        { server, autoConnect: false },
        React.createElement(AddTool, { name: 'static_tool' }),
      ),
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('"static_tool" was not registered')));
    view.unmount();
    warn.mockRestore();
  });

  it('registers a tool aimed at a named secondary server on that server only', async () => {
    const primary = serverDouble();
    const second = serverDouble([]);

    const view = render(
      React.createElement(
        FrontMcpProvider,
        { server: primary.server, servers: { second: second.server }, autoConnect: false },
        React.createElement(AddTool, { name: 'second_add', server: 'second' }),
      ),
    );

    await waitFor(() => expect(second.registered.has('second_add')).toBe(true));
    expect(primary.registered.has('second_add')).toBe(false);

    view.unmount();
    expect(second.unregisters.get('second_add')).toHaveBeenCalledTimes(1);
  });

  it("registers tools into each server's app from dynamicToolApps, unless a tool names its own", async () => {
    const primary = serverDouble();
    const second = serverDouble([]);
    const servers = { second: second.server };
    const tree = () =>
      React.createElement(
        FrontMcpProvider,
        {
          server: primary.server,
          servers,
          // A new object on every render, with the same content
          dynamicToolApps: { default: 'billing', second: 'analytics' },
          autoConnect: false,
        },
        React.createElement(AddTool),
        React.createElement(AddTool, { name: 'support_add', app: 'support' }),
        React.createElement(AddTool, { name: 'second_add', server: 'second' }),
      );

    const view = render(tree());
    await waitFor(() => expect(second.registered.has('second_add')).toBe(true));
    await waitFor(() => expect(primary.registered.has('support_add')).toBe(true));
    await act(async () => {
      view.rerender(tree());
    });

    expect(primary.registered.get('add')?.app).toBe('billing');
    expect(primary.registered.get('support_add')?.app).toBe('support');
    expect(second.registered.get('second_add')?.app).toBe('analytics');
    expect(primary.server.registerTool).toHaveBeenCalledTimes(2);
    expect(second.server.registerTool).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
