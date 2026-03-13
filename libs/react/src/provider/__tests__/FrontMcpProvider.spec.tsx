import React from 'react';
import { render, act, screen, renderHook } from '@testing-library/react';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import { FrontMcpProvider } from '../FrontMcpProvider';
import { FrontMcpContext } from '../FrontMcpContext';
import { serverRegistry } from '../../registry/ServerRegistry';
import { useFrontMcp } from '../../hooks/useFrontMcp';

// ─── helpers ──────────────────────────────────────────────────────────────────

function createMockClient(overrides?: Partial<DirectClient>): DirectClient {
  return {
    listTools: jest.fn().mockResolvedValue([{ name: 'tool1' }]),
    listResources: jest.fn().mockResolvedValue({ resources: [{ uri: 'file://a' }] }),
    listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [{ uriTemplate: 'file://{x}' }] }),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [{ name: 'prompt1' }] }),
    callTool: jest.fn(),
    readResource: jest.fn(),
    getPrompt: jest.fn(),
    subscribeResource: jest.fn().mockResolvedValue(undefined),
    unsubscribeResource: jest.fn().mockResolvedValue(undefined),
    onResourceUpdated: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  } as unknown as DirectClient;
}

function createMockServer(client?: DirectClient): DirectMcpServer {
  return {
    connect: jest.fn().mockResolvedValue(client ?? createMockClient()),
    callTool: jest.fn(),
  } as unknown as DirectMcpServer;
}

/** Reads slim context values from a rendered provider. */
function ContextReader({ onContext }: { onContext: (val: unknown) => void }) {
  const ctx = React.useContext(FrontMcpContext);
  React.useEffect(() => {
    onContext(ctx);
  });
  return React.createElement('div', { 'data-testid': 'child' }, 'child');
}

/** Reads resolved server state via useFrontMcp. */
function StateReader({ onState }: { onState: (val: unknown) => void }) {
  const state = useFrontMcp();
  React.useEffect(() => {
    onState(state);
  });
  return React.createElement('div', { 'data-testid': 'state-child' }, 'state');
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('FrontMcpProvider', () => {
  beforeEach(() => {
    serverRegistry.clear();
  });

  // ─── rendering ──────────────────────────────────────────────────────────

  it('renders children', async () => {
    const server = createMockServer();

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server, autoConnect: false },
          React.createElement('span', { 'data-testid': 'kid' }, 'hello'),
        ),
      );
    });

    expect(screen.getByTestId('kid').textContent).toBe('hello');
  });

  // ─── slim context ──────────────────────────────────────────────────────

  it('provides slim context with name, registry, and connect', async () => {
    const server = createMockServer();
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server, autoConnect: false },
          React.createElement(ContextReader, {
            onContext: (ctx: unknown) => {
              captured = ctx as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(captured['name']).toBe('default');
    expect(captured['registry']).toBeDefined();
    expect(typeof captured['connect']).toBe('function');
    // Should NOT have status/tools/etc on context
    expect(captured['status']).toBeUndefined();
    expect(captured['tools']).toBeUndefined();
  });

  // ─── name prop ──────────────────────────────────────────────────────────

  it('uses custom name prop', async () => {
    const server = createMockServer();
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server, name: 'my-server', autoConnect: false },
          React.createElement(ContextReader, {
            onContext: (ctx: unknown) => {
              captured = ctx as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(captured['name']).toBe('my-server');
    expect(serverRegistry.has('my-server')).toBe(true);
  });

  // ─── auto-connect ──────────────────────────────────────────────────────

  it('auto-connects on mount and populates registry', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(server.connect).toHaveBeenCalledTimes(1);
    expect(captured['status']).toBe('connected');
    expect(captured['tools']).toEqual([{ name: 'tool1' }]);
    expect(captured['resources']).toEqual([{ uri: 'file://a' }]);
    expect(captured['resourceTemplates']).toEqual([{ uriTemplate: 'file://{x}' }]);
    expect(captured['prompts']).toEqual([{ name: 'prompt1' }]);
  });

  // ─── manual connect ────────────────────────────────────────────────────

  it('does not connect when autoConnect=false, then connects via connect()', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server, autoConnect: false },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    // Not connected yet
    expect(server.connect).not.toHaveBeenCalled();
    expect(captured['status']).toBe('idle');

    // Manually connect
    await act(async () => {
      await (captured['connect'] as () => Promise<void>)();
    });

    expect(server.connect).toHaveBeenCalledTimes(1);
    expect(captured['status']).toBe('connected');
  });

  // ─── error handling ─────────────────────────────────────────────────────

  it('sets error status when server.connect() throws', async () => {
    const server = {
      connect: jest.fn().mockRejectedValue(new Error('boom')),
      callTool: jest.fn(),
    } as unknown as DirectMcpServer;

    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(captured['status']).toBe('error');
    expect((captured['error'] as Error).message).toBe('boom');
  });

  it('wraps non-Error thrown values', async () => {
    const server = {
      connect: jest.fn().mockRejectedValue('string-error'),
      callTool: jest.fn(),
    } as unknown as DirectMcpServer;

    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(captured['status']).toBe('error');
    expect((captured['error'] as Error).message).toBe('string-error');
  });

  // ─── server registry integration ───────────────────────────────────────

  it('registers server as "default" in serverRegistry', async () => {
    const server = createMockServer();

    await act(async () => {
      render(
        React.createElement(FrontMcpProvider, { server, autoConnect: false }, React.createElement('div', null, 'x')),
      );
    });

    expect(serverRegistry.has('default')).toBe(true);
    expect(serverRegistry.get('default')!.server).toBe(server);
  });

  it('registers additional servers from the servers prop', async () => {
    const defaultServer = createMockServer();
    const analyticsServer = createMockServer();
    const loggingServer = createMockServer();

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          {
            server: defaultServer,
            servers: { analytics: analyticsServer, logging: loggingServer },
            autoConnect: false,
          },
          React.createElement('div', null, 'x'),
        ),
      );
    });

    expect(serverRegistry.has('default')).toBe(true);
    expect(serverRegistry.has('analytics')).toBe(true);
    expect(serverRegistry.has('logging')).toBe(true);
    expect(serverRegistry.get('analytics')!.server).toBe(analyticsServer);
    expect(serverRegistry.get('logging')!.server).toBe(loggingServer);
  });

  it('unregisters servers on unmount', async () => {
    const server = createMockServer();
    const extraServer = createMockServer();

    let unmount!: () => void;

    await act(async () => {
      const result = render(
        React.createElement(
          FrontMcpProvider,
          { server, servers: { extra: extraServer }, autoConnect: false },
          React.createElement('div', null, 'x'),
        ),
      );
      unmount = result.unmount;
    });

    expect(serverRegistry.has('default')).toBe(true);
    expect(serverRegistry.has('extra')).toBe(true);

    act(() => {
      unmount();
    });

    expect(serverRegistry.has('default')).toBe(false);
    expect(serverRegistry.has('extra')).toBe(false);
  });

  // ─── auto-connect syncs additional servers ──────────────────────────────

  it('auto-connects additional servers from servers prop', async () => {
    const mockClient = createMockClient();
    const defaultServer = createMockServer(mockClient);
    const extraServer = createMockServer(createMockClient());

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server: defaultServer, servers: { extra: extraServer } },
          React.createElement('div', null, 'x'),
        ),
      );
    });

    // The default server connects via provider
    expect(defaultServer.connect).toHaveBeenCalledTimes(1);
    // The extra server is connected via serverRegistry.connect
    expect(extraServer.connect).toHaveBeenCalledTimes(1);
  });

  // ─── callbacks ──────────────────────────────────────────────────────────

  it('calls onConnected callback after successful connection', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);
    const onConnected = jest.fn();

    await act(async () => {
      render(React.createElement(FrontMcpProvider, { server, onConnected }, React.createElement('div', null, 'x')));
    });

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledWith(mockClient);
  });

  it('calls onError callback when connection fails', async () => {
    const server = {
      connect: jest.fn().mockRejectedValue(new Error('fail')),
      callTool: jest.fn(),
    } as unknown as DirectMcpServer;
    const onError = jest.fn();

    await act(async () => {
      render(React.createElement(FrontMcpProvider, { server, onError }, React.createElement('div', null, 'x')));
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('fail');
  });

  // ─── component registry ─────────────────────────────────────────────────

  it('populates ComponentRegistry from components prop', async () => {
    const MyComp = () => React.createElement('div', null, 'my');
    const server = createMockServer();
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          {
            server,
            autoConnect: false,
            components: { 'component://MyComp': MyComp },
          },
          React.createElement(ContextReader, {
            onContext: (ctx: unknown) => {
              captured = ctx as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    const reg = captured['registry'] as { has: (uri: string) => boolean; get: (uri: string) => unknown };
    expect(reg.has('component://MyComp')).toBe(true);
    expect(reg.get('component://MyComp')).toBe(MyComp);
  });

  // ─── registry update on connect ─────────────────────────────────────────

  it('syncs connected state back to serverRegistry', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);

    await act(async () => {
      render(React.createElement(FrontMcpProvider, { server }, React.createElement('div', null, 'x')));
    });

    const entry = serverRegistry.get('default');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('connected');
    expect(entry!.client).toBe(mockClient);
  });

  // ─── does not re-connect if already connected ───────────────────────────

  it('does not call connect twice on manual connect when already connected', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    // Already connected, calling connect again should be a no-op
    await act(async () => {
      await (captured['connect'] as () => Promise<void>)();
    });

    expect(server.connect).toHaveBeenCalledTimes(1);
  });

  // ─── default context ────────────────────────────────────────────────────

  it('default context connect is a no-op', async () => {
    const { result } = renderHook(() => React.useContext(FrontMcpContext));
    await result.current.connect();
    // Should not throw — exercises the default async () => {} in createContext
  });

  // ─── default resources when fields missing ──────────────────────────────

  it('defaults resources/templates/prompts to [] when response omits fields', async () => {
    const mockClient = createMockClient({
      listResources: jest.fn().mockResolvedValue({}),
      listResourceTemplates: jest.fn().mockResolvedValue({}),
      listPrompts: jest.fn().mockResolvedValue({}),
    } as Partial<DirectClient>);
    const server = createMockServer(mockClient);
    let captured: Record<string, unknown> = {};

    await act(async () => {
      render(
        React.createElement(
          FrontMcpProvider,
          { server },
          React.createElement(StateReader, {
            onState: (state: unknown) => {
              captured = state as Record<string, unknown>;
            },
          }),
        ),
      );
    });

    expect(captured['resources']).toEqual([]);
    expect(captured['resourceTemplates']).toEqual([]);
    expect(captured['prompts']).toEqual([]);
  });
});
