import type { CallToolResult, DirectMcpServer, ReadResourceResult } from '@frontmcp/sdk';

import type { DynamicResourceDef, DynamicToolDef } from '../../types';
import { createWrappedServer } from '../createWrappedServer';
import { DynamicRegistry } from '../DynamicRegistry';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockBaseServer(overrides: Partial<Record<keyof DirectMcpServer, unknown>> = {}): DirectMcpServer {
  return {
    ready: Promise.resolve(),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn().mockResolvedValue({ content: [] }),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
    readResource: jest.fn().mockResolvedValue({ contents: [] }),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    getPrompt: jest.fn().mockResolvedValue({ messages: [] }),
    listJobs: jest.fn().mockResolvedValue({ content: [] }),
    executeJob: jest.fn().mockResolvedValue({ content: [] }),
    getJobStatus: jest.fn().mockResolvedValue({ content: [] }),
    listWorkflows: jest.fn().mockResolvedValue({ content: [] }),
    executeWorkflow: jest.fn().mockResolvedValue({ content: [] }),
    getWorkflowStatus: jest.fn().mockResolvedValue({ content: [] }),
    connect: jest.fn().mockResolvedValue({}),
    dispose: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DirectMcpServer;
}

function createToolDef(overrides: Partial<DynamicToolDef> = {}): DynamicToolDef {
  return {
    name: overrides.name ?? 'dyn-tool',
    description: overrides.description ?? 'Dynamic tool',
    inputSchema: overrides.inputSchema ?? { type: 'object' },
    execute: overrides.execute ?? jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'dynamic' }] }),
  };
}

function createResourceDef(overrides: Partial<DynamicResourceDef> = {}): DynamicResourceDef {
  return {
    uri: overrides.uri ?? 'dyn://resource',
    name: overrides.name ?? 'dyn-resource',
    description: overrides.description ?? 'Dynamic resource',
    mimeType: overrides.mimeType ?? 'text/plain',
    read: overrides.read ?? jest.fn().mockResolvedValue({ contents: [{ uri: 'dyn://resource', text: 'dynamic' }] }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createWrappedServer', () => {
  let base: DirectMcpServer;
  let dynamicRegistry: DynamicRegistry;
  let wrapped: DirectMcpServer;

  beforeEach(() => {
    base = createMockBaseServer();
    dynamicRegistry = new DynamicRegistry();
    wrapped = createWrappedServer(base, dynamicRegistry);
  });

  // ─── ready ──────────────────────────────────────────────────────────────

  describe('ready', () => {
    it('delegates to base server ready property', () => {
      expect(wrapped.ready).toBe(base.ready);
    });
  });

  // ─── tools ──────────────────────────────────────────────────────────────
  // Dynamic tools are registered with the server as real tools (bindDynamicTools), so the wrapper
  // passes tool operations straight through: the server lists and runs them.

  describe('listTools', () => {
    it('returns the base listing, even when dynamic tools are registered', async () => {
      const baseTools = [{ name: 'base-tool', description: 'Base' }];
      (base.listTools as jest.Mock).mockResolvedValue({ tools: baseTools });
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn1' }));

      const result = await wrapped.listTools();
      expect(result).toEqual({ tools: baseTools });
    });

    it('passes options to base listTools', async () => {
      const opts = { authContext: { sessionId: 's1' } };
      await wrapped.listTools(opts);
      expect(base.listTools).toHaveBeenCalledWith(opts);
    });
  });

  describe('callTool', () => {
    it('calls the base server, even for a dynamic tool name', async () => {
      const dynExecute = jest.fn();
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn', execute: dynExecute }));
      const baseResult: CallToolResult = { content: [{ type: 'text', text: 'through the server' }] };
      (base.callTool as jest.Mock).mockResolvedValue(baseResult);

      const result = await wrapped.callTool('dyn', { key: 'val' }, { authContext: { sessionId: 's' } });

      expect(base.callTool).toHaveBeenCalledWith('dyn', { key: 'val' }, { authContext: { sessionId: 's' } });
      expect(result).toBe(baseResult);
      expect(dynExecute).not.toHaveBeenCalled();
    });
  });

  describe('registerTool', () => {
    it('delegates to the base server', async () => {
      const unregister = jest.fn();
      const registerTool = jest.fn().mockResolvedValue(unregister);
      wrapped = createWrappedServer(createMockBaseServer({ registerTool }), dynamicRegistry);
      const definition = { name: 'runtime', execute: jest.fn() };

      const result = await wrapped.registerTool(definition);

      expect(registerTool).toHaveBeenCalledWith(definition);
      expect(result).toBe(unregister);
    });
  });

  // ─── listResources ─────────────────────────────────────────────────────

  describe('listResources', () => {
    it('returns base resources when no dynamic resources registered', async () => {
      const baseResources = [{ uri: 'file://a', name: 'A' }];
      (base.listResources as jest.Mock).mockResolvedValue({ resources: baseResources });

      const result = await wrapped.listResources();
      expect(result).toEqual({ resources: baseResources });
    });

    it('returns only dynamic resources when base has none', async () => {
      (base.listResources as jest.Mock).mockResolvedValue({ resources: [] });
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dyn://1', name: 'Dyn1' }));

      const result = await wrapped.listResources();
      const resources = (result as { resources: unknown[] }).resources;
      expect(resources).toHaveLength(1);
      expect((resources[0] as { uri: string }).uri).toBe('dyn://1');
    });

    it('merges base and dynamic resources', async () => {
      (base.listResources as jest.Mock).mockResolvedValue({
        resources: [
          { uri: 'base://only', name: 'Base Only' },
          { uri: 'shared://r', name: 'Base Shared' },
        ],
      });
      dynamicRegistry.registerResource(createResourceDef({ uri: 'shared://r', name: 'Dyn Shared' }));
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dyn://only', name: 'Dyn Only' }));

      const result = await wrapped.listResources();
      const resources = (result as { resources: Array<{ uri: string; name: string }> }).resources;

      expect(resources).toHaveLength(3);
      expect(resources.find((r) => r.uri === 'base://only')?.name).toBe('Base Only');
      expect(resources.find((r) => r.uri === 'shared://r')?.name).toBe('Dyn Shared');
      expect(resources.find((r) => r.uri === 'dyn://only')?.name).toBe('Dyn Only');
    });

    it('dynamic resources take precedence on URI collision', async () => {
      (base.listResources as jest.Mock).mockResolvedValue({
        resources: [{ uri: 'dup://x', name: 'BASE' }],
      });
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dup://x', name: 'DYNAMIC' }));

      const result = await wrapped.listResources();
      const resources = (result as { resources: Array<{ uri: string; name: string }> }).resources;

      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe('DYNAMIC');
    });

    it('passes options to base listResources', async () => {
      const opts = { authContext: { sessionId: 's1' } };
      await wrapped.listResources(opts);
      expect(base.listResources).toHaveBeenCalledWith(opts);
    });

    it('passes the paging options to base listResources (#678)', async () => {
      const opts = { paginate: true, cursor: 'page-2' };
      await wrapped.listResources(opts);
      expect(base.listResources).toHaveBeenCalledWith(opts);
    });

    it('adds the dynamic resources to the first page only when paging (#678)', async () => {
      (base.listResources as jest.Mock)
        .mockResolvedValueOnce({ resources: [{ uri: 'base://1', name: 'B1' }], nextCursor: 'page-2' })
        .mockResolvedValueOnce({
          resources: [
            { uri: 'base://2', name: 'B2' },
            { uri: 'dyn://r', name: 'Shadowed' },
          ],
        });
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dyn://r', name: 'Dyn' }));

      const first = (await wrapped.listResources({ paginate: true })) as {
        resources: Array<{ uri: string }>;
        nextCursor?: string;
      };
      const second = (await wrapped.listResources({ cursor: first.nextCursor })) as {
        resources: Array<{ uri: string }>;
      };

      expect(first.resources.map((r) => r.uri)).toEqual(['base://1', 'dyn://r']);
      expect(first.nextCursor).toBe('page-2');
      expect(second.resources.map((r) => r.uri)).toEqual(['base://2']);
    });

    it('handles base result without resources field', async () => {
      (base.listResources as jest.Mock).mockResolvedValue({});
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dyn://r' }));

      const result = await wrapped.listResources();
      const resources = (result as { resources: unknown[] }).resources;
      expect(resources).toHaveLength(1);
    });

    it('maps dynamic resources to ResourceInfo shape (uri, name, description, mimeType only)', async () => {
      (base.listResources as jest.Mock).mockResolvedValue({ resources: [] });
      dynamicRegistry.registerResource(
        createResourceDef({ uri: 'mapped://r', name: 'Mapped', description: 'desc', mimeType: 'application/json' }),
      );

      const result = await wrapped.listResources();
      const resources = (result as { resources: unknown[] }).resources;

      expect(resources[0]).toEqual({
        uri: 'mapped://r',
        name: 'Mapped',
        description: 'desc',
        mimeType: 'application/json',
      });
      // read function should NOT be in the result
      expect(resources[0]).not.toHaveProperty('read');
    });
  });

  // ─── readResource ──────────────────────────────────────────────────────

  describe('readResource', () => {
    it('reads from dynamic resource when URI matches', async () => {
      const readResult: ReadResourceResult = { contents: [{ uri: 'dyn://r', text: 'dynamic content' }] };
      const readFn = jest.fn().mockResolvedValue(readResult);
      dynamicRegistry.registerResource(createResourceDef({ uri: 'dyn://r', read: readFn }));

      const result = await wrapped.readResource('dyn://r');

      expect(readFn).toHaveBeenCalled();
      expect(result).toEqual(readResult);
      expect(base.readResource).not.toHaveBeenCalled();
    });

    it('falls back to base server when no dynamic resource matches', async () => {
      const baseResult: ReadResourceResult = { contents: [{ uri: 'base://r', text: 'base content' }] };
      (base.readResource as jest.Mock).mockResolvedValue(baseResult);

      const result = await wrapped.readResource('base://r', { authContext: { sessionId: 's' } });

      expect(base.readResource).toHaveBeenCalledWith('base://r', { authContext: { sessionId: 's' } });
      expect(result).toEqual(baseResult);
    });

    it('dynamic resource takes priority over base resource with same URI', async () => {
      const dynRead = jest.fn().mockResolvedValue({ contents: [{ uri: 'shared://r', text: 'dyn' }] });
      dynamicRegistry.registerResource(createResourceDef({ uri: 'shared://r', read: dynRead }));
      (base.readResource as jest.Mock).mockResolvedValue({ contents: [{ uri: 'shared://r', text: 'base' }] });

      const result = await wrapped.readResource('shared://r');
      expect((result as ReadResourceResult).contents[0]).toEqual({ uri: 'shared://r', text: 'dyn' });
      expect(base.readResource).not.toHaveBeenCalled();
    });
  });

  // ─── Delegated methods ─────────────────────────────────────────────────

  describe('listPrompts', () => {
    it('delegates directly to base server', async () => {
      const prompts = { prompts: [{ name: 'p1' }] };
      (base.listPrompts as jest.Mock).mockResolvedValue(prompts);

      const result = await wrapped.listPrompts();
      expect(result).toEqual(prompts);
      expect(base.listPrompts).toHaveBeenCalledTimes(1);
    });

    it('passes options to base', async () => {
      const opts = { authContext: { sessionId: 'x' } };
      await wrapped.listPrompts(opts);
      expect(base.listPrompts).toHaveBeenCalledWith(opts);
    });
  });

  describe('getPrompt', () => {
    it('delegates directly to base server', async () => {
      const promptResult = { messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] };
      (base.getPrompt as jest.Mock).mockResolvedValue(promptResult);

      const result = await wrapped.getPrompt('my-prompt', { arg: 'val' });
      expect(result).toEqual(promptResult);
      expect(base.getPrompt).toHaveBeenCalledWith('my-prompt', { arg: 'val' }, undefined);
    });

    it('passes options to base', async () => {
      const opts = { authContext: { sessionId: 'x' } };
      await wrapped.getPrompt('p', {}, opts);
      expect(base.getPrompt).toHaveBeenCalledWith('p', {}, opts);
    });
  });

  describe('listResourceTemplates', () => {
    it('delegates directly to base server', async () => {
      const templates = { resourceTemplates: [{ uriTemplate: 'file://{name}' }] };
      (base.listResourceTemplates as jest.Mock).mockResolvedValue(templates);

      const result = await wrapped.listResourceTemplates();
      expect(result).toEqual(templates);
      expect(base.listResourceTemplates).toHaveBeenCalledTimes(1);
    });

    it('passes options to base', async () => {
      const opts = { authContext: { sessionId: 'x' } };
      await wrapped.listResourceTemplates(opts);
      expect(base.listResourceTemplates).toHaveBeenCalledWith(opts);
    });
  });

  describe('listJobs', () => {
    it('delegates directly to base server', async () => {
      const jobsResult = { content: [{ type: 'text', text: '[]' }] };
      (base.listJobs as jest.Mock).mockResolvedValue(jobsResult);

      const result = await wrapped.listJobs();
      expect(result).toEqual(jobsResult);
      expect(base.listJobs).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeJob', () => {
    it('delegates directly to base server', async () => {
      const jobResult = { content: [{ type: 'text', text: 'done' }] };
      (base.executeJob as jest.Mock).mockResolvedValue(jobResult);

      const result = await wrapped.executeJob('job1', { input: 'val' });
      expect(result).toEqual(jobResult);
      expect(base.executeJob).toHaveBeenCalledWith('job1', { input: 'val' }, undefined);
    });
  });

  describe('getJobStatus', () => {
    it('delegates directly to base server', async () => {
      const statusResult = { content: [{ type: 'text', text: 'running' }] };
      (base.getJobStatus as jest.Mock).mockResolvedValue(statusResult);

      const result = await wrapped.getJobStatus('run-123');
      expect(result).toEqual(statusResult);
      expect(base.getJobStatus).toHaveBeenCalledWith('run-123', undefined);
    });
  });

  describe('listWorkflows', () => {
    it('delegates directly to base server', async () => {
      const wfResult = { content: [{ type: 'text', text: '[]' }] };
      (base.listWorkflows as jest.Mock).mockResolvedValue(wfResult);

      const result = await wrapped.listWorkflows();
      expect(result).toEqual(wfResult);
      expect(base.listWorkflows).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeWorkflow', () => {
    it('delegates directly to base server', async () => {
      const wfResult = { content: [{ type: 'text', text: 'executed' }] };
      (base.executeWorkflow as jest.Mock).mockResolvedValue(wfResult);

      const result = await wrapped.executeWorkflow('wf1', { x: 1 });
      expect(result).toEqual(wfResult);
      expect(base.executeWorkflow).toHaveBeenCalledWith('wf1', { x: 1 }, undefined);
    });
  });

  describe('getWorkflowStatus', () => {
    it('delegates directly to base server', async () => {
      const statusResult = { content: [{ type: 'text', text: 'complete' }] };
      (base.getWorkflowStatus as jest.Mock).mockResolvedValue(statusResult);

      const result = await wrapped.getWorkflowStatus('wf-run-1');
      expect(result).toEqual(statusResult);
      expect(base.getWorkflowStatus).toHaveBeenCalledWith('wf-run-1', undefined);
    });
  });

  describe('connect', () => {
    it('delegates directly to base server', async () => {
      const mockClient = { listTools: jest.fn() };
      (base.connect as jest.Mock).mockResolvedValue(mockClient);

      const result = await wrapped.connect('session-1');
      expect(result).toBe(mockClient);
      expect(base.connect).toHaveBeenCalledWith('session-1');
    });

    it('passes ConnectOptions to base', async () => {
      const opts = { sessionId: 's', clientInfo: { name: 'test', version: '1.0' } };
      await wrapped.connect(opts);
      expect(base.connect).toHaveBeenCalledWith(opts);
    });

    it("leaves the client's callTool alone, so dynamic tools are called through the server", async () => {
      const callTool = jest.fn();
      (base.connect as jest.Mock).mockResolvedValue({ callTool });
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn' }));

      const client = await wrapped.connect();

      expect(client.callTool).toBe(callTool);
    });
  });

  describe('connect: dynamic resource subscriptions', () => {
    function makeClient() {
      let baseHandler: ((uri: string) => void) | undefined;
      const offBase = jest.fn();
      const baseSubscribe = jest.fn().mockResolvedValue(undefined);
      const baseUnsubscribe = jest.fn().mockResolvedValue(undefined);
      return {
        baseSubscribe,
        baseUnsubscribe,
        client: {
          subscribeResource: baseSubscribe,
          unsubscribeResource: baseUnsubscribe,
          onResourceUpdated: jest.fn((h: (uri: string) => void) => {
            baseHandler = h;
            return offBase;
          }),
        },
        emitBase: (uri: string) => baseHandler?.(uri),
        offBase,
      };
    }

    it('notifies onResourceUpdated handlers when a dynamic resource changes', async () => {
      const { client } = makeClient();
      (base.connect as jest.Mock).mockResolvedValue(client);
      const wrappedClient = await wrapped.connect();
      dynamicRegistry.registerResource(createResourceDef({ uri: 'state://counter' }));

      const handler = jest.fn();
      wrappedClient.onResourceUpdated(handler);
      dynamicRegistry.updateResourceRead('state://counter', jest.fn());

      expect(handler).toHaveBeenCalledWith('state://counter');
    });

    it('still forwards server notifications and unsubscribes from both sources', async () => {
      const { client, emitBase, offBase } = makeClient();
      (base.connect as jest.Mock).mockResolvedValue(client);
      const wrappedClient = await wrapped.connect();
      dynamicRegistry.registerResource(createResourceDef({ uri: 'state://counter' }));

      const handler = jest.fn();
      const off = wrappedClient.onResourceUpdated(handler);
      emitBase('file://remote');
      expect(handler).toHaveBeenCalledWith('file://remote');

      off();
      expect(offBase).toHaveBeenCalled();
      dynamicRegistry.updateResourceRead('state://counter', jest.fn());
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not ask the server to subscribe to dynamic resources', async () => {
      const { client, baseSubscribe, baseUnsubscribe } = makeClient();
      (base.connect as jest.Mock).mockResolvedValue(client);
      const wrappedClient = await wrapped.connect();
      dynamicRegistry.registerResource(createResourceDef({ uri: 'state://counter' }));

      await wrappedClient.subscribeResource('state://counter');
      await wrappedClient.unsubscribeResource('state://counter');
      expect(baseSubscribe).not.toHaveBeenCalled();
      expect(baseUnsubscribe).not.toHaveBeenCalled();

      await wrappedClient.subscribeResource('file://remote');
      await wrappedClient.unsubscribeResource('file://remote');
      expect(baseSubscribe).toHaveBeenCalledWith('file://remote');
      expect(baseUnsubscribe).toHaveBeenCalledWith('file://remote');
    });
  });

  describe('dispose', () => {
    it('delegates directly to base server', async () => {
      await wrapped.dispose();
      expect(base.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
