/** Direct-only scopes (#827) serve what they served before, without the parts that serve HTTP. */
import 'reflect-metadata';

import type { GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';

import { DirectPublicAuth } from '../../auth/direct-public-auth';
import { LocalPrimaryAuth } from '../../auth/instances/instance.local-primary-auth';
import { App, LogLevel, Prompt, Resource, Tool, type FlowName } from '../../common';
import { PromptContext, ResourceContext, ToolContext } from '../../common/interfaces';
import { FlowNotRegisteredError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { ScopeRegistry } from '../../scope/scope.registry';
import type { DirectClient } from '../client.types';
import { connect } from '../connect';
import { create } from '../create';
import type { CreateConfig } from '../create.types';

@Tool({ name: 'lookup', inputSchema: {}, execution: { taskSupport: 'optional' } })
class LookupTool extends ToolContext {
  async execute() {
    this.notifyResourceListChanged();
    return { found: true };
  }
}

@Resource({ name: 'policy', uri: 'desk://policy', mimeType: 'text/plain' })
class PolicyResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'Be kind.' }] };
  }
}

@Prompt({ name: 'greet', arguments: [] })
class GreetPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'Hello.' } }] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [LookupTool], resources: [PolicyResource], prompts: [GreetPrompt] })
class DeskApp {}

const info = { name: 'direct-only-desk', version: '1.0.0' };
const logging = { level: LogLevel.Off };
const createConfig: CreateConfig = {
  info,
  logging,
  tools: [LookupTool],
  resources: [PolicyResource],
  prompts: [GreetPrompt],
};
const serverConfig = { info, logging, apps: [DeskApp] };

/** Start a server, and the primary scope it serves. */
async function withScope<T>(start: () => Promise<T>): Promise<{ served: T; scope: Scope }> {
  const primaryScope = jest.spyOn(ScopeRegistry.prototype, 'getPrimaryScope');
  try {
    const served = await start();
    return { served, scope: primaryScope.mock.results[0]?.value as Scope };
  } finally {
    primaryScope.mockRestore();
  }
}

async function isFlowRegistered(scope: Scope, name: FlowName): Promise<boolean> {
  const outcome = await scope.runFlowForOutput(name, {} as never).catch((error: unknown) => error);
  return !(outcome instanceof FlowNotRegisteredError);
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Run `lookup` as a task, and report the status it ends with. */
async function runLookupTask(scope: Scope): Promise<string> {
  const ctx = { authInfo: { sessionId: 'direct-only-task-session' } };
  const created = (await scope.runFlowForOutput('tools:call-tool', {
    request: { method: 'tools/call', params: { name: 'lookup', arguments: {}, task: { ttl: 60_000 } } },
    ctx,
  })) as unknown as { task: { taskId: string } };
  const taskStatus = async () =>
    (
      (await scope.runFlowForOutput('tasks:get', {
        request: { method: 'tasks/get', params: { taskId: created.task.taskId } },
        ctx,
      })) as unknown as { status: string }
    ).status;
  for (let attempt = 0; attempt < 50 && (await taskStatus()) === 'working'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return taskStatus();
}

/** What a client of the desk server is served: tools, resources, prompts, notifications and tasks. */
async function expectDeskServed(client: DirectClient, scope: Scope): Promise<void> {
  const notifications: string[] = [];
  client.onNotification((notification) => notifications.push(notification.method));

  const tools = (await client.listTools()) as Array<{ name: string }>;
  expect(tools.map((tool) => tool.name)).toEqual(['lookup']);
  expect(await client.callTool('lookup', {})).toMatchObject({ structuredContent: { found: true } });
  await settle();
  expect(notifications).toContain('notifications/resources/list_changed');

  expect((await client.readResource('desk://policy')).contents[0]).toMatchObject({ text: 'Be kind.' });
  expect((await client.getPrompt('greet')).messages[0]?.content).toMatchObject({ text: 'Hello.' });

  expect(client.getCapabilities().tasks).toBeDefined();
  expect(await runLookupTask(scope)).toBe('completed');
}

async function expectDirectOnly(scope: Scope): Promise<void> {
  expect(scope.transportService).toBeUndefined();
  expect(scope.healthService).toBeUndefined();
  expect(scope.httpRoutes).toEqual([]);
  expect(await isFlowRegistered(scope, 'http:request')).toBe(false);
  expect(await isFlowRegistered(scope, 'http:ip-filter')).toBe(false);
}

describe('direct-only scopes', () => {
  it('create() without auth serves everything, with a public auth and no HTTP or OAuth parts', async () => {
    const { served: server, scope } = await withScope(() => create(createConfig));
    const client = await server.connect();
    try {
      await expectDeskServed(client, scope);
      await expectDirectOnly(scope);
      expect(scope.auth).toBeInstanceOf(DirectPublicAuth);
      expect(scope.auth.options).toMatchObject({ mode: 'public' });
      expect(await isFlowRegistered(scope, 'session:verify')).toBe(false);
      expect(await isFlowRegistered(scope, 'oauth:token')).toBe(false);
    } finally {
      await client.close();
      await server.dispose();
    }
  });

  it('connect() without auth serves everything, with a public auth and no HTTP or OAuth parts', async () => {
    const { served: client, scope } = await withScope(() => connect({ ...serverConfig }));
    try {
      await expectDeskServed(client, scope);
      await expectDirectOnly(scope);
      expect(scope.auth).toBeInstanceOf(DirectPublicAuth);
      expect(scope.auth.options).toMatchObject({ mode: 'public' });
      expect(await isFlowRegistered(scope, 'session:verify')).toBe(false);
      expect(await isFlowRegistered(scope, 'oauth:token')).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('create() with auth keeps the auth of its mode and its flows, as before', async () => {
    const { served: server, scope } = await withScope(() => create({ ...createConfig, auth: { mode: 'public' } }));
    const client = await server.connect();
    try {
      await expectDeskServed(client, scope);
      await expectDirectOnly(scope);
      expect(scope.auth).toBeInstanceOf(LocalPrimaryAuth);
      expect(await isFlowRegistered(scope, 'session:verify')).toBe(true);
      expect(await isFlowRegistered(scope, 'oauth:token')).toBe(true);
    } finally {
      await client.close();
      await server.dispose();
    }
  });

  it('a server served over HTTP keeps its transport, HTTP flows, health checks and OAuth flows', async () => {
    const instance = await FrontMcpInstance.createForGraph(serverConfig);
    const scope = instance.getPrimaryScope() as Scope;
    try {
      expect(scope.transportService).toBeDefined();
      expect(scope.healthService).toBeDefined();
      expect(scope.auth).toBeInstanceOf(LocalPrimaryAuth);
      for (const flow of ['http:request', 'http:ip-filter', 'session:verify', 'oauth:token'] as const) {
        expect(await isFlowRegistered(scope, flow)).toBe(true);
      }
    } finally {
      await instance.shutdown();
    }
  });
});
