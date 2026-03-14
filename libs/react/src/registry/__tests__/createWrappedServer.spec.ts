import type { DirectMcpServer, CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import type { DynamicToolDef, DynamicResourceDef } from '../../types';
import { DynamicRegistry } from '../DynamicRegistry';
import { createWrappedServer } from '../createWrappedServer';

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

  // ─── listTools ──────────────────────────────────────────────────────────

  describe('listTools', () => {
    it('returns base tools when no dynamic tools registered', async () => {
      const baseTools = [{ name: 'base-tool', description: 'Base' }];
      (base.listTools as jest.Mock).mockResolvedValue({ tools: baseTools });

      const result = await wrapped.listTools();
      expect(result).toEqual({ tools: baseTools });
    });

    it('returns only dynamic tools when base has no tools', async () => {
      (base.listTools as jest.Mock).mockResolvedValue({ tools: [] });
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn1', description: 'Dynamic 1' }));

      const result = await wrapped.listTools();
      expect((result as { tools: unknown[] }).tools).toEqual([
        { name: 'dyn1', description: 'Dynamic 1', inputSchema: { type: 'object' } },
      ]);
    });

    it('merges base and dynamic tools', async () => {
      (base.listTools as jest.Mock).mockResolvedValue({
        tools: [
          { name: 'base-only', description: 'Base only tool' },
          { name: 'shared', description: 'Base version' },
        ],
      });
      dynamicRegistry.registerTool(createToolDef({ name: 'shared', description: 'Dynamic version' }));
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn-only', description: 'Dynamic only' }));

      const result = await wrapped.listTools();
      const tools = (result as { tools: Array<{ name: string; description: string }> }).tools;

      expect(tools).toHaveLength(3);
      expect(tools.find((t) => t.name === 'base-only')?.description).toBe('Base only tool');
      expect(tools.find((t) => t.name === 'shared')?.description).toBe('Dynamic version');
      expect(tools.find((t) => t.name === 'dyn-only')?.description).toBe('Dynamic only');
    });

    it('dynamic tools take precedence on name collision', async () => {
      (base.listTools as jest.Mock).mockResolvedValue({
        tools: [{ name: 'collide', description: 'BASE', inputSchema: { type: 'string' } }],
      });
      dynamicRegistry.registerTool(createToolDef({ name: 'collide', description: 'DYNAMIC' }));

      const result = await wrapped.listTools();
      const tools = (result as { tools: Array<{ name: string; description: string }> }).tools;

      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe('DYNAMIC');
    });

    it('passes options to base listTools', async () => {
      const opts = { authContext: { sessionId: 's1' } };
      await wrapped.listTools(opts);
      expect(base.listTools).toHaveBeenCalledWith(opts);
    });

    it('handles base result without tools field', async () => {
      (base.listTools as jest.Mock).mockResolvedValue({});
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn' }));

      const result = await wrapped.listTools();
      const tools = (result as { tools: unknown[] }).tools;
      expect(tools).toHaveLength(1);
      expect((tools[0] as { name: string }).name).toBe('dyn');
    });

    it('maps dynamic tools to ToolInfo shape (name, description, inputSchema only)', async () => {
      (base.listTools as jest.Mock).mockResolvedValue({ tools: [] });
      const executeFn = jest.fn();
      dynamicRegistry.registerTool(
        createToolDef({
          name: 'mapped',
          description: 'desc',
          inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
          execute: executeFn,
        }),
      );

      const result = await wrapped.listTools();
      const tools = (result as { tools: unknown[] }).tools;

      expect(tools[0]).toEqual({
        name: 'mapped',
        description: 'desc',
        inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      });
      // execute function should NOT be in the result
      expect(tools[0]).not.toHaveProperty('execute');
    });
  });

  // ─── callTool ───────────────────────────────────────────────────────────

  describe('callTool', () => {
    it('calls dynamic tool when name matches', async () => {
      const executeFn = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'dynamic-result' }] });
      dynamicRegistry.registerTool(createToolDef({ name: 'dyn', execute: executeFn }));

      const result = await wrapped.callTool('dyn', { key: 'val' });

      expect(executeFn).toHaveBeenCalledWith({ key: 'val' });
      expect(result).toEqual({ content: [{ type: 'text', text: 'dynamic-result' }] });
      expect(base.callTool).not.toHaveBeenCalled();
    });

    it('falls back to base server when no dynamic tool matches', async () => {
      const baseResult = { content: [{ type: 'text', text: 'base-result' }] };
      (base.callTool as jest.Mock).mockResolvedValue(baseResult);

      const result = await wrapped.callTool('base-tool', { arg: 1 }, { authContext: { sessionId: 's' } });

      expect(base.callTool).toHaveBeenCalledWith('base-tool', { arg: 1 }, { authContext: { sessionId: 's' } });
      expect(result).toEqual(baseResult);
    });

    it('passes empty object to dynamic execute when args is undefined', async () => {
      const executeFn = jest.fn().mockResolvedValue({ content: [] });
      dynamicRegistry.registerTool(createToolDef({ name: 'no-args', execute: executeFn }));

      await wrapped.callTool('no-args', undefined);

      expect(executeFn).toHaveBeenCalledWith({});
    });

    it('dynamic tool takes priority over base tool with same name', async () => {
      const dynExecute = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'dyn' }] });
      dynamicRegistry.registerTool(createToolDef({ name: 'shared', execute: dynExecute }));
      (base.callTool as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'base' }] });

      const result = await wrapped.callTool('shared', {});
      expect((result as CallToolResult).content[0]).toEqual({ type: 'text', text: 'dyn' });
      expect(base.callTool).not.toHaveBeenCalled();
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
  });

  describe('dispose', () => {
    it('delegates directly to base server', async () => {
      await wrapped.dispose();
      expect(base.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
