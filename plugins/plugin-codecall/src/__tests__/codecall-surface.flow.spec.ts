/**
 * CodeCall acts for the MCP client that called it, so `availableWhen.surface` applies to the
 * tools it reaches exactly as it does to that client's own `tools/call`.
 *
 * CodeCall ran its inner calls with a context that carried no surface, so an MCP client could
 * run, describe and find a tool offered only to agents (`surface: ['agent']`) by going through
 * `codecall:invoke`, `codecall:execute`, `codecall:describe` or `codecall:search`.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import {
  App,
  createInMemoryServer,
  FrontMcpInstance,
  LogLevel,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

const executedTools: string[] = [];

@Tool({ name: 'users:list', description: 'Lists the users of the account', inputSchema: {} })
class ListUsersTool extends ToolContext {
  async execute() {
    executedTools.push('users:list');
    return { ran: 'users:list' };
  }
}

@Tool({
  name: 'secrets:rotate',
  description: 'Rotates the signing secrets of the account',
  inputSchema: {},
  availableWhen: { surface: ['agent'] },
})
class RotateSecretsTool extends ToolContext {
  async execute() {
    executedTools.push('secrets:rotate');
    return { ran: 'secrets:rotate' };
  }
}

@Skill({
  name: 'user-audit',
  description: 'Audit the users of the account',
  instructions: 'List the users and review them.',
  tools: ['users:list'],
})
class UserAuditSkill extends SkillContext {}

@Skill({
  name: 'secret-rotation',
  description: 'Audit and rotate the signing secrets of the account',
  instructions: 'Rotate the secrets.',
  tools: ['users:list'],
  availableWhen: { surface: ['agent'] },
})
class SecretRotationSkill extends SkillContext {}

@App({
  id: 'ops',
  name: 'Ops',
  tools: [ListUsersTool, RotateSecretsTool],
  skills: [UserAuditSkill, SecretRotationSkill],
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
})
class OpsApp {}

function structured<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

describe('CodeCall applies the MCP caller’s surface to the tools it reaches', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-surface', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const server = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'codecall-surface-spec', version: '1.0.0' });
    await client.connect(server.clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    executedTools.length = 0;
  });

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  it('refuses codecall:invoke on an agent-only tool, like an unknown one', async () => {
    const restricted = await call('codecall:invoke', { tool: 'secrets:rotate', input: {} });
    const unknown = await call('codecall:invoke', { tool: 'secrets:nothing', input: {} });

    expect({
      isError: restricted.isError,
      text: JSON.stringify(restricted.content).split('secrets:rotate').join('<tool>'),
    }).toEqual({
      isError: unknown.isError,
      text: JSON.stringify(unknown.content).split('secrets:nothing').join('<tool>'),
    });
    expect(restricted.isError).toBe(true);
    expect(executedTools).toEqual([]);
  });

  it('refuses callTool on an agent-only tool from codecall:execute, and describes it to no script', async () => {
    const run = structured<{ status: string; result?: unknown }>(
      await call('codecall:execute', { script: `return await callTool('secrets:rotate', {});` }),
    );
    const introspect = structured<{ status: string; result?: unknown }>(
      await call('codecall:execute', { script: `return getTool('secrets:rotate') === undefined;` }),
    );

    expect({ run: run.status === 'ok', hidden: introspect.result }).toEqual({ run: false, hidden: true });
    expect(executedTools).toEqual([]);
  });

  it('reports an agent-only tool as not found from codecall:describe', async () => {
    const outcome = structured<{ tools: Array<{ name: string }>; notFound?: string[] }>(
      await call('codecall:describe', { toolNames: ['secrets:rotate', 'users:list'] }),
    );

    expect({ described: outcome.tools.map((tool) => tool.name), notFound: outcome.notFound }).toEqual({
      described: ['users:list'],
      notFound: ['secrets:rotate'],
    });
  });

  it('finds no agent-only tool from codecall:search', async () => {
    const outcome = structured<{ tools: Array<{ name: string }> }>(
      await call('codecall:search', { queries: ['rotate signing secrets', 'list users'], minRelevanceScore: 0 }),
    );

    expect(outcome.tools.map((tool) => tool.name)).toEqual(['users:list']);
  });

  it('finds no agent-only skill from codecall:searchSkills', async () => {
    const outcome = structured<{ skills: Array<{ name: string }> }>(
      await call('codecall:searchSkills', { queries: ['audit account', 'rotate secrets'], minRelevanceScore: 0 }),
    );

    expect(outcome.skills.map((skill) => skill.name)).toEqual(['user-audit']);
  });

  it('still runs a tool the MCP caller may reach', async () => {
    const invoked = await call('codecall:invoke', { tool: 'users:list', input: {} });
    const run = structured<{ status: string }>(
      await call('codecall:execute', { script: `return await callTool('users:list', {});` }),
    );
    const found = structured<{ tools: Array<{ name: string }> }>(
      await call('codecall:search', { queries: ['list users'], minRelevanceScore: 0 }),
    );

    expect({
      invoked: invoked.isError ?? false,
      run: run.status,
      found: found.tools.map((t) => t.name).filter((name) => name === 'users:list'),
    }).toEqual({
      invoked: false,
      run: 'ok',
      found: ['users:list'],
    });
    expect(executedTools).toEqual(['users:list', 'users:list']);
  });
});
