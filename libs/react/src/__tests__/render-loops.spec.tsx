import { act, render } from '@testing-library/react';
import React from 'react';

import type { DirectClient, DirectMcpServer, RuntimeToolDefinition } from '@frontmcp/sdk';

import { useApiClient } from '../api/useApiClient';
import { useListTools } from '../hooks/useListTools';
import { FrontMcpContext } from '../provider/FrontMcpContext';
import { FrontMcpProvider } from '../provider/FrontMcpProvider';
import type { DynamicRegistry } from '../registry/DynamicRegistry';
import { serverRegistry } from '../registry/ServerRegistry';
import { useReduxResource } from '../state/useReduxResource';
import { useStoreResource } from '../state/useStoreResource';
import { useValtioResource } from '../state/useValtioResource';

function reduxStore() {
  let state = { count: 0 };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action: unknown) => {
      state = { count: state.count + 1 };
      listeners.forEach((l) => l());
      return action;
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

type Notification = { method: string; params?: unknown };

/** A server double that lists and announces registered tools the way a real server does. */
function serverDouble(): DirectMcpServer {
  const registered = new Map<string, RuntimeToolDefinition>();
  const handlers = new Set<(notification: Notification) => void>();
  const announce = () => {
    for (const handler of handlers) handler({ method: 'notifications/tools/list_changed' });
  };
  const client = {
    listTools: async () => [...registered.values()].map(({ name }) => ({ name })),
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    listPrompts: async () => ({ prompts: [] }),
    onResourceUpdated: () => () => undefined,
    onNotification: (handler: (notification: Notification) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  } as unknown as DirectClient;
  return {
    connect: async () => client,
    listResources: async () => ({ resources: [] }),
    registerTool: async (definition: RuntimeToolDefinition) => {
      registered.set(definition.name, definition);
      announce();
      return () => {
        registered.delete(definition.name);
        announce();
      };
    },
  } as unknown as DirectMcpServer;
}

describe('render loops', () => {
  let server: DirectMcpServer;
  beforeEach(() => {
    server = serverDouble();
  });
  afterEach(() => {
    serverRegistry.clear();
  });

  async function rendersOf(Component: React.FC<{ onRender: () => void }>): Promise<number> {
    let renders = 0;
    const onRender = () => {
      renders++;
      if (renders > 200) throw new Error('render loop');
    };
    render(
      <FrontMcpProvider server={server}>
        <Component onRender={onRender} />
      </FrontMcpProvider>,
    );
    await settle();
    const settled = renders;
    await settle();
    return renders - settled;
  }

  it('useReduxResource(opts) + useListTools', async () => {
    const opts = { store: reduxStore(), name: 'counter' };
    const extra = await rendersOf(({ onRender }) => {
      onRender();
      useReduxResource(opts);
      useListTools();
      return null;
    });
    expect(extra).toBe(0);
  });

  it('useStoreResource inline', async () => {
    const store = reduxStore();
    const extra = await rendersOf(({ onRender }) => {
      onRender();
      useStoreResource({
        name: 'inline',
        getState: () => store.getState(),
        subscribe: (cb) => store.subscribe(cb),
        selectors: { count: (s) => (s as { count: number }).count },
        actions: { inc: () => store.dispatch({ type: 'inc' }) },
      });
      useListTools();
      return null;
    });
    expect(extra).toBe(0);
  });

  it('useValtioResource inline', async () => {
    const proxy = { user: { name: 'a' } };
    const subscribe = (_p: object, _cb: () => void) => () => undefined;
    const extra = await rendersOf(({ onRender }) => {
      onRender();
      useValtioResource({
        proxy,
        subscribe,
        name: 'v',
        paths: { name: 'user.name' },
        mutations: { set: () => undefined },
      });
      useListTools();
      return null;
    });
    expect(extra).toBe(0);
  });

  it('useApiClient inline operations', async () => {
    const extra = await rendersOf(({ onRender }) => {
      onRender();
      useApiClient({
        baseUrl: 'https://api.example.com',
        operations: [
          { operationId: 'get', description: 'Get', method: 'GET', path: '/x', inputSchema: { type: 'object' } },
        ],
        client: { request: async () => ({ status: 200, data: null }) },
      });
      useListTools();
      return null;
    });
    expect(extra).toBe(0);
  });

  describe('provider resource listing', () => {
    function Registrar({ uri }: { uri: string }) {
      const { dynamicRegistry } = React.useContext(FrontMcpContext);
      React.useEffect(
        () => dynamicRegistry.registerResource({ uri, name: uri, read: async () => ({ contents: [] }) }),
        [dynamicRegistry, uri],
      );
      return null;
    }

    it('does not update the server entry when a resource is registered again unchanged', async () => {
      const view = render(
        <FrontMcpProvider server={server}>
          <Registrar uri="state://a" />
        </FrontMcpProvider>,
      );
      await settle();
      const listener = jest.fn();
      const unsubscribe = serverRegistry.subscribe(listener);
      const ctx = { registry: null as DynamicRegistry | null };
      function Grab() {
        ctx.registry = React.useContext(FrontMcpContext).dynamicRegistry;
        return null;
      }
      view.rerender(
        <FrontMcpProvider server={server}>
          <Registrar uri="state://a" />
          <Grab />
        </FrontMcpProvider>,
      );
      listener.mockClear();

      act(() => {
        ctx.registry?.unregisterResource('state://a');
        ctx.registry?.registerResource({ uri: 'state://a', name: 'state://a', read: async () => ({ contents: [] }) });
      });
      await settle();

      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('updates the server entry when the resources change', async () => {
      const view = render(
        <FrontMcpProvider server={server}>
          <Registrar uri="state://a" />
        </FrontMcpProvider>,
      );
      await settle();

      view.rerender(
        <FrontMcpProvider server={server}>
          <Registrar uri="state://b" />
        </FrontMcpProvider>,
      );
      await settle();

      expect(serverRegistry.get('default')?.resources.map((r) => r.uri)).toEqual(['state://b']);
    });
  });
});
