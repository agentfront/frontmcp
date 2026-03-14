import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import { ServerRegistry } from '../ServerRegistry';

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

describe('ServerRegistry', () => {
  let registry: ServerRegistry;

  beforeEach(() => {
    registry = new ServerRegistry();
  });

  // ─── register / unregister ──────────────────────────────────────────────

  describe('register', () => {
    it('registers a server with idle status', () => {
      const server = createMockServer();
      registry.register('my-server', server);

      const entry = registry.get('my-server');
      expect(entry).toBeDefined();
      expect(entry!.server).toBe(server);
      expect(entry!.client).toBeNull();
      expect(entry!.status).toBe('idle');
      expect(entry!.error).toBeNull();
      expect(entry!.tools).toEqual([]);
      expect(entry!.resources).toEqual([]);
      expect(entry!.resourceTemplates).toEqual([]);
      expect(entry!.prompts).toEqual([]);
    });

    it('overwrites an existing entry when registering the same name', () => {
      const server1 = createMockServer();
      const server2 = createMockServer();
      registry.register('srv', server1);
      registry.register('srv', server2);

      expect(registry.get('srv')!.server).toBe(server2);
    });
  });

  describe('unregister', () => {
    it('removes a registered server', () => {
      registry.register('srv', createMockServer());
      registry.unregister('srv');
      expect(registry.get('srv')).toBeUndefined();
      expect(registry.has('srv')).toBe(false);
    });

    it('is a no-op for an unregistered name', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  // ─── get / has / list ───────────────────────────────────────────────────

  describe('get', () => {
    it('returns the entry for a registered server', () => {
      const server = createMockServer();
      registry.register('a', server);
      expect(registry.get('a')!.server).toBe(server);
    });

    it('returns undefined for an unregistered server', () => {
      expect(registry.get('missing')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for a registered server', () => {
      registry.register('x', createMockServer());
      expect(registry.has('x')).toBe(true);
    });

    it('returns false for an unregistered server', () => {
      expect(registry.has('x')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns names of all registered servers', () => {
      registry.register('a', createMockServer());
      registry.register('b', createMockServer());
      registry.register('c', createMockServer());
      expect(registry.list()).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array when no servers registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  // ─── connect ────────────────────────────────────────────────────────────

  describe('connect', () => {
    it('connects a registered server and populates tools/resources/templates/prompts', async () => {
      const tools = [{ name: 'tool1' }];
      const resources = [{ uri: 'file://a' }];
      const resourceTemplates = [{ uriTemplate: 'file://{name}' }];
      const prompts = [{ name: 'prompt1' }];

      const mockClient = createMockClient();
      (mockClient.listTools as jest.Mock).mockResolvedValue(tools);
      (mockClient.listResources as jest.Mock).mockResolvedValue({ resources });
      (mockClient.listResourceTemplates as jest.Mock).mockResolvedValue({ resourceTemplates });
      (mockClient.listPrompts as jest.Mock).mockResolvedValue({ prompts });

      const server = createMockServer(mockClient);
      registry.register('srv', server);

      const client = await registry.connect('srv');

      expect(client).toBe(mockClient);
      const entry = registry.get('srv')!;
      expect(entry.status).toBe('connected');
      expect(entry.client).toBe(mockClient);
      expect(entry.tools).toEqual(tools);
      expect(entry.resources).toEqual(resources);
      expect(entry.resourceTemplates).toEqual(resourceTemplates);
      expect(entry.prompts).toEqual(prompts);
      expect(entry.error).toBeNull();
    });

    it('sets status to connecting before the connection resolves', async () => {
      const statuses: string[] = [];
      const mockClient = createMockClient();
      let resolveConnect!: (c: DirectClient) => void;
      const server = {
        connect: jest.fn().mockReturnValue(
          new Promise<DirectClient>((resolve) => {
            resolveConnect = resolve;
          }),
        ),
      } as unknown as DirectMcpServer;

      registry.register('srv', server);
      registry.subscribe(() => {
        statuses.push(registry.get('srv')!.status);
      });

      const connectPromise = registry.connect('srv');
      // At this point, status should have been set to 'connecting'
      expect(statuses).toContain('connecting');

      resolveConnect(mockClient);
      await connectPromise;
      expect(statuses).toContain('connected');
    });

    it('returns existing client when already connected', async () => {
      const mockClient = createMockClient();
      const server = createMockServer(mockClient);
      registry.register('srv', server);

      const client1 = await registry.connect('srv');
      const client2 = await registry.connect('srv');

      expect(client1).toBe(client2);
      expect(server.connect).toHaveBeenCalledTimes(1);
    });

    it('throws when connecting an unregistered server', async () => {
      await expect(registry.connect('nonexistent')).rejects.toThrow('Server "nonexistent" not registered');
    });

    it('sets status to error when server.connect() rejects', async () => {
      const server = {
        connect: jest.fn().mockRejectedValue(new Error('connection failed')),
      } as unknown as DirectMcpServer;

      registry.register('srv', server);

      await expect(registry.connect('srv')).rejects.toThrow('connection failed');

      const entry = registry.get('srv')!;
      expect(entry.status).toBe('error');
      expect(entry.error).toBeInstanceOf(Error);
      expect(entry.error!.message).toBe('connection failed');
    });

    it('wraps non-Error rejection values in an Error', async () => {
      const server = {
        connect: jest.fn().mockRejectedValue('string failure'),
      } as unknown as DirectMcpServer;

      registry.register('srv', server);

      await expect(registry.connect('srv')).rejects.toThrow('string failure');

      const entry = registry.get('srv')!;
      expect(entry.error).toBeInstanceOf(Error);
      expect(entry.error!.message).toBe('string failure');
    });

    it('sets status to error when listTools rejects', async () => {
      const mockClient = createMockClient();
      (mockClient.listTools as jest.Mock).mockRejectedValue(new Error('list failed'));

      const server = createMockServer(mockClient);
      registry.register('srv', server);

      await expect(registry.connect('srv')).rejects.toThrow('list failed');

      const entry = registry.get('srv')!;
      expect(entry.status).toBe('error');
    });

    it('creates new entry objects during connect (immutable)', async () => {
      const mockClient = createMockClient();
      const server = createMockServer(mockClient);
      registry.register('srv', server);
      const entryBefore = registry.get('srv')!;

      await registry.connect('srv');

      const entryAfter = registry.get('srv')!;
      expect(entryAfter).not.toBe(entryBefore);
      expect(entryAfter.status).toBe('connected');
      expect(entryAfter.client).toBe(mockClient);
    });

    it('defaults resources to [] when response has no resources field', async () => {
      const mockClient = createMockClient();
      (mockClient.listResources as jest.Mock).mockResolvedValue({});
      (mockClient.listResourceTemplates as jest.Mock).mockResolvedValue({});
      (mockClient.listPrompts as jest.Mock).mockResolvedValue({});

      const server = createMockServer(mockClient);
      registry.register('srv', server);
      await registry.connect('srv');

      const entry = registry.get('srv')!;
      expect(entry.resources).toEqual([]);
      expect(entry.resourceTemplates).toEqual([]);
      expect(entry.prompts).toEqual([]);
    });
  });

  // ─── connectAll ─────────────────────────────────────────────────────────

  describe('connectAll', () => {
    it('connects all registered servers', async () => {
      const server1 = createMockServer();
      const server2 = createMockServer();
      registry.register('a', server1);
      registry.register('b', server2);

      await registry.connectAll();

      expect(registry.get('a')!.status).toBe('connected');
      expect(registry.get('b')!.status).toBe('connected');
      expect(server1.connect).toHaveBeenCalledTimes(1);
      expect(server2.connect).toHaveBeenCalledTimes(1);
    });

    it('handles empty registry', async () => {
      await expect(registry.connectAll()).resolves.toBeUndefined();
    });
  });

  // ─── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    it('merges partial updates into an existing entry', () => {
      registry.register('srv', createMockServer());
      registry.update('srv', { status: 'connected', tools: [{ name: 't1' }] });

      const entry = registry.get('srv')!;
      expect(entry.status).toBe('connected');
      expect(entry.tools).toEqual([{ name: 't1' }]);
      // Other fields unchanged
      expect(entry.resources).toEqual([]);
    });

    it('creates a new entry object (immutable)', () => {
      registry.register('srv', createMockServer());
      const entryBefore = registry.get('srv')!;
      registry.update('srv', { status: 'connected' });
      const entryAfter = registry.get('srv')!;

      expect(entryAfter).not.toBe(entryBefore);
      expect(entryAfter.status).toBe('connected');
      expect(entryAfter.server).toBe(entryBefore.server);
    });

    it('is a no-op for an unregistered server', () => {
      const versionBefore = registry.getVersion();
      registry.update('nonexistent', { status: 'error' });
      expect(registry.getVersion()).toBe(versionBefore);
    });
  });

  // ─── clear ──────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all entries', () => {
      registry.register('a', createMockServer());
      registry.register('b', createMockServer());
      registry.clear();

      expect(registry.list()).toEqual([]);
      expect(registry.has('a')).toBe(false);
      expect(registry.has('b')).toBe(false);
    });
  });

  // ─── subscribe / notify ─────────────────────────────────────────────────

  describe('subscribe', () => {
    it('calls listeners on register', () => {
      const listener = jest.fn();
      registry.subscribe(listener);
      registry.register('x', createMockServer());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on unregister', () => {
      registry.register('x', createMockServer());
      const listener = jest.fn();
      registry.subscribe(listener);
      registry.unregister('x');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on connect', async () => {
      registry.register('x', createMockServer());
      const listener = jest.fn();
      registry.subscribe(listener);
      await registry.connect('x');
      // connecting + connected = at least 2
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('calls listeners on update', () => {
      registry.register('x', createMockServer());
      const listener = jest.fn();
      registry.subscribe(listener);
      registry.update('x', { status: 'error' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on clear', () => {
      registry.register('x', createMockServer());
      const listener = jest.fn();
      registry.subscribe(listener);
      registry.clear();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const listener = jest.fn();
      const unsub = registry.subscribe(listener);
      unsub();
      registry.register('x', createMockServer());
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      registry.subscribe(l1);
      registry.subscribe(l2);
      registry.register('x', createMockServer());
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getVersion ─────────────────────────────────────────────────────────

  describe('getVersion', () => {
    it('starts at 0', () => {
      expect(registry.getVersion()).toBe(0);
    });

    it('increments on register', () => {
      registry.register('x', createMockServer());
      expect(registry.getVersion()).toBe(1);
    });

    it('increments on unregister', () => {
      registry.register('x', createMockServer());
      registry.unregister('x');
      expect(registry.getVersion()).toBe(2);
    });

    it('increments on clear', () => {
      registry.register('x', createMockServer());
      registry.clear();
      expect(registry.getVersion()).toBe(2);
    });

    it('increments on update', () => {
      registry.register('x', createMockServer());
      registry.update('x', { status: 'connected' });
      expect(registry.getVersion()).toBe(2);
    });

    it('increments multiple times during connect (connecting + connected)', async () => {
      registry.register('x', createMockServer());
      const v0 = registry.getVersion();
      await registry.connect('x');
      // at least 2 increments: connecting + connected
      expect(registry.getVersion()).toBeGreaterThanOrEqual(v0 + 2);
    });
  });
});
