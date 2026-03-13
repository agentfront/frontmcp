import React from 'react';
import { render, act } from '@testing-library/react';
import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import { serverRegistry } from '../../registry/ServerRegistry';
import { useServer } from '../useServer';
import type { ServerEntry } from '../../registry/ServerRegistry';

// ─── helpers ──────────────────────────────────────────────────────────────────

function createMockClient(): DirectClient {
  return {
    listTools: jest.fn().mockResolvedValue([]),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    callTool: jest.fn(),
    readResource: jest.fn(),
    getPrompt: jest.fn(),
    subscribeResource: jest.fn().mockResolvedValue(undefined),
    unsubscribeResource: jest.fn().mockResolvedValue(undefined),
    onResourceUpdated: jest.fn().mockReturnValue(() => {}),
  } as unknown as DirectClient;
}

function createMockServer(client?: DirectClient): DirectMcpServer {
  return {
    connect: jest.fn().mockResolvedValue(client ?? createMockClient()),
    callTool: jest.fn(),
  } as unknown as DirectMcpServer;
}

/** Renders the useServer hook and captures results. */
function HookReader({ name, onEntry }: { name?: string; onEntry: (entry: ServerEntry | undefined) => void }) {
  const entry = useServer(name);
  React.useEffect(() => {
    onEntry(entry);
  });
  return React.createElement('div', { 'data-testid': 'entry-status' }, entry?.status ?? 'none');
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useServer', () => {
  beforeEach(() => {
    serverRegistry.clear();
  });

  it('returns undefined when no server is registered', () => {
    let captured: ServerEntry | undefined = { status: 'idle' } as ServerEntry;

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured).toBeUndefined();
  });

  it('returns the entry after a server is registered', () => {
    const server = createMockServer();
    serverRegistry.register('default', server);

    let captured: ServerEntry | undefined;

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured).toBeDefined();
    expect(captured!.server).toBe(server);
    expect(captured!.status).toBe('idle');
  });

  it('returns "default" entry when no name is given', () => {
    const defaultServer = createMockServer();
    const otherServer = createMockServer();
    serverRegistry.register('default', defaultServer);
    serverRegistry.register('other', otherServer);

    let captured: ServerEntry | undefined;

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured!.server).toBe(defaultServer);
  });

  it('returns the named entry when a specific name is given', () => {
    const defaultServer = createMockServer();
    const analyticsServer = createMockServer();
    serverRegistry.register('default', defaultServer);
    serverRegistry.register('analytics', analyticsServer);

    let captured: ServerEntry | undefined;

    act(() => {
      render(
        React.createElement(HookReader, {
          name: 'analytics',
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured!.server).toBe(analyticsServer);
  });

  it('re-renders when the registry changes', async () => {
    const statuses: string[] = [];

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            statuses.push(entry?.status ?? 'none');
          },
        }),
      );
    });

    // Initially no server registered
    expect(statuses).toContain('none');

    // Register a server
    await act(async () => {
      serverRegistry.register('default', createMockServer());
    });

    expect(statuses).toContain('idle');
  });

  it('reflects connected status after registry connect', async () => {
    const mockClient = createMockClient();
    const server = createMockServer(mockClient);
    serverRegistry.register('default', server);

    let captured: ServerEntry | undefined;

    render(
      React.createElement(HookReader, {
        onEntry: (entry) => {
          captured = entry;
        },
      }),
    );

    expect(captured!.status).toBe('idle');

    await act(async () => {
      await serverRegistry.connect('default');
    });

    // The entry is mutated in place by the registry, so the same
    // object reference now has status === 'connected'.
    expect(captured!.status).toBe('connected');
    expect(captured!.client).toBe(mockClient);
  });

  it('returns undefined for a non-existent named server', () => {
    serverRegistry.register('default', createMockServer());

    let captured: ServerEntry | undefined = { status: 'idle' } as ServerEntry;

    act(() => {
      render(
        React.createElement(HookReader, {
          name: 'nonexistent',
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured).toBeUndefined();
  });

  it('updates when server entry is updated', async () => {
    serverRegistry.register('default', createMockServer());

    let captured: ServerEntry | undefined;

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured!.tools).toEqual([]);

    await act(async () => {
      serverRegistry.update('default', { tools: [{ name: 'new-tool' }] });
    });

    expect(captured!.tools).toEqual([{ name: 'new-tool' }]);
  });

  it('returns undefined after clear', async () => {
    serverRegistry.register('default', createMockServer());

    let captured: ServerEntry | undefined = { status: 'idle' } as ServerEntry;

    act(() => {
      render(
        React.createElement(HookReader, {
          onEntry: (entry) => {
            captured = entry;
          },
        }),
      );
    });

    expect(captured).toBeDefined();

    await act(async () => {
      serverRegistry.clear();
    });

    expect(captured).toBeUndefined();
  });
});
