/**
 * Platform bindings for direct servers (#706).
 *
 * `this.workerEnv` came only from the `env` a Worker request carries, so a direct server embedded
 * in a Worker (a Durable Object, a queue consumer, a custom route) could not reach its KV, D1 or
 * R2. `create({ workerEnv })` / `createDirect({ workerEnv })` set a server-wide default,
 * `DirectCallOptions.workerEnv` overrides it for one call and `ConnectOptions.workerEnv` for a
 * client. The bindings live in each request's context only.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult, GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';

import { Agent, AgentContext, App, Job, LogLevel, Prompt, Resource, Tool } from '../../common';
import { JobContext, PromptContext, ResourceContext, ToolContext } from '../../common/interfaces';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { clearScopeCache, connect } from '../connect';
import { clearCreateCache, create } from '../create';
import { type DirectMcpServer, type DirectWorkerEnv } from '../direct.types';

interface FakeKv {
  get(key: string): string;
}

/** `<TENANT>/<KV>`: which string binding, and which KV object, the code saw. */
function describeEnv(env: Readonly<Record<string, unknown>> | undefined): string {
  if (!env) return 'no workerEnv';
  const kv = env['MY_KV'] as FakeKv | undefined;
  return `${String(env['TENANT'])}/${kv ? kv.get('k') : 'no-kv'}`;
}

function bindings(tenant: string): DirectWorkerEnv {
  return { TENANT: tenant, MY_KV: { get: (key: string) => `${tenant}-${key}` } satisfies FakeKv };
}

let releaseSlowTool: (() => void) | undefined;
let nestedServer: DirectMcpServer | undefined;

@Tool({ name: 'env_tool', inputSchema: {} })
class EnvTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: describeEnv(this.workerEnv) }] };
  }
}

/** Reads the bindings before and after an await another call's bindings would race with. */
@Tool({ name: 'slow_env_tool', inputSchema: { wait: z.boolean() } })
class SlowEnvTool extends ToolContext {
  async execute(input: { wait: boolean }): Promise<CallToolResult> {
    const before = describeEnv(this.workerEnv);
    if (input.wait) await new Promise<void>((resolve) => (releaseSlowTool = resolve));
    else releaseSlowTool?.();
    return { content: [{ type: 'text', text: `${before}|${describeEnv(this.workerEnv)}` }] };
  }
}

/** Calls the server again from inside a call, with bindings of its own. */
@Tool({ name: 'nested_env_tool', inputSchema: {} })
class NestedEnvTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    if (!nestedServer) throw new Error('direct server is not ready');
    const inner = await nestedServer.callTool('env_tool', {}, { workerEnv: bindings('inner') });
    const innerText = inner.content[0]?.type === 'text' ? inner.content[0].text : '';
    return { content: [{ type: 'text', text: `${innerText}|${describeEnv(this.workerEnv)}` }] };
  }
}

@Resource({ name: 'env_resource', uri: 'env://bindings', mimeType: 'text/plain' })
class EnvResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: describeEnv(this.workerEnv) }] };
  }
}

@Prompt({ name: 'env_prompt', arguments: [] })
class EnvPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: describeEnv(this.workerEnv) } }] };
  }
}

@Job({ name: 'env_job', inputSchema: {}, outputSchema: { env: z.string() } })
class EnvJob extends JobContext {
  async execute() {
    return { env: describeEnv(this.workerEnv) };
  }
}

@Agent({
  name: 'env_agent',
  description: 'Reports its bindings',
  inputSchema: {},
  llm: { adapter: { completion: jest.fn().mockResolvedValue({ content: 'unused', finishReason: 'stop' }) } },
})
class EnvAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    return { env: describeEnv(this.workerEnv) };
  }
}

@App({
  id: 'bindings',
  name: 'bindings',
  tools: [EnvTool, SlowEnvTool, NestedEnvTool],
  resources: [EnvResource],
  prompts: [EnvPrompt],
  jobs: [EnvJob],
  agents: [EnvAgent],
})
class BindingsApp {}

const serverInfo = { name: 'direct-worker-env', version: '1.0.0' };

function text(result: CallToolResult): string | undefined {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : undefined;
}

describe('workerEnv on a direct server (#706)', () => {
  describe('with a server-wide default', () => {
    let server: DirectMcpServer;
    const serverEnv = bindings('server');

    beforeAll(async () => {
      server = await FrontMcpInstance.createDirect({
        info: serverInfo,
        apps: [BindingsApp],
        jobs: { enabled: true },
        logging: { level: LogLevel.Off },
        workerEnv: serverEnv,
      });
      nestedServer = server;
    });

    afterAll(async () => {
      await server.dispose();
    });

    it('reaches a tool, a resource and a prompt', async () => {
      const tool = await server.callTool('env_tool', {});
      const resource = await server.readResource('env://bindings');
      const prompt = await server.getPrompt('env_prompt', {});

      expect(text(tool)).toBe('server/server-k');
      expect(resource.contents[0]).toMatchObject({ text: 'server/server-k' });
      expect(prompt.messages[0].content).toMatchObject({ text: 'server/server-k' });
    });

    it('reaches a job run by executeJob and an agent', async () => {
      const job = await server.executeJob('env_job', {});
      const agent = await server.callTool('invoke_env_agent', {});

      expect(job.structuredContent).toMatchObject({ state: 'completed', result: { env: 'server/server-k' } });
      expect(agent.structuredContent).toMatchObject({ env: 'server/server-k' });
    });

    it("lets a call's own workerEnv replace the default, for that call only", async () => {
      const override = await server.callTool('env_tool', {}, { workerEnv: bindings('call') });
      const after = await server.callTool('env_tool', {});
      const resource = await server.readResource('env://bindings', { workerEnv: bindings('call') });
      const job = await server.executeJob('env_job', {}, { workerEnv: bindings('call') });

      expect(text(override)).toBe('call/call-k');
      expect(text(after)).toBe('server/server-k');
      expect(resource.contents[0]).toMatchObject({ text: 'call/call-k' });
      expect(job.structuredContent).toMatchObject({ result: { env: 'call/call-k' } });
    });

    it('replaces rather than merges: keys only the default has are gone', async () => {
      const result = await server.callTool('env_tool', {}, { workerEnv: { TENANT: 'only-tenant' } });

      expect(text(result)).toBe('only-tenant/no-kv');
    });

    it('hands connected clients the default, or their own bindings', async () => {
      const inherits = await server.connect();
      const own = await server.connect({ workerEnv: bindings('client') });
      try {
        expect(text((await inherits.callTool('env_tool', {})) as CallToolResult)).toBe('server/server-k');
        expect(text((await own.callTool('env_tool', {})) as CallToolResult)).toBe('client/client-k');
      } finally {
        await inherits.close();
        await own.close();
      }
    });

    it('keeps concurrent calls with different bindings apart', async () => {
      releaseSlowTool = undefined;
      const first = server.callTool('slow_env_tool', { wait: true }, { workerEnv: bindings('a') });
      // Let the first call park, then run the second while it waits.
      while (!releaseSlowTool) await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await server.callTool('slow_env_tool', { wait: false }, { workerEnv: bindings('b') });

      expect(text(second)).toBe('b/b-k|b/b-k');
      expect(text(await first)).toBe('a/a-k|a/a-k');
    });

    it('gives a call made from inside another call its own bindings, and leaves the outer ones alone', async () => {
      const result = await server.callTool('nested_env_tool', {}, { workerEnv: bindings('outer') });

      expect(text(result)).toBe('inner/inner-k|outer/outer-k');
    });

    it('never writes the bindings to process.env', async () => {
      delete process.env['TENANT'];
      await server.callTool('env_tool', {}, { workerEnv: bindings('call') });

      expect(process.env['TENANT']).toBeUndefined();
      expect(process.env['MY_KV']).toBeUndefined();
    });
  });

  describe('connect()', () => {
    afterEach(() => clearScopeCache());

    it('gives each client of a shared server its own bindings', async () => {
      const config = { info: serverInfo, apps: [BindingsApp], logging: { level: LogLevel.Off } };
      const first = await connect(config, { workerEnv: bindings('first') });
      const second = await connect(config, { workerEnv: bindings('second') });
      try {
        expect(text((await first.callTool('env_tool', {})) as CallToolResult)).toBe('first/first-k');
        expect(text((await second.callTool('env_tool', {})) as CallToolResult)).toBe('second/second-k');
      } finally {
        await first.close();
        await second.close();
      }
    });
  });

  describe('create()', () => {
    afterEach(() => clearCreateCache());

    it('takes the default as a flat option and leaves it out of the server config', async () => {
      const server = await create({
        info: serverInfo,
        tools: [EnvTool],
        logging: { level: LogLevel.Off },
        workerEnv: bindings('flat'),
      });
      try {
        expect(text(await server.callTool('env_tool', {}))).toBe('flat/flat-k');
        expect(text(await server.callTool('env_tool', {}, { workerEnv: bindings('call') }))).toBe('call/call-k');
      } finally {
        await server.dispose();
      }
    });

    it('leaves workerEnv undefined when neither the server nor the call passes one', async () => {
      const server = await create({ info: serverInfo, tools: [EnvTool], logging: { level: LogLevel.Off } });
      try {
        expect(text(await server.callTool('env_tool', {}))).toBe('no workerEnv');
        expect(text(await server.callTool('env_tool', {}, { workerEnv: bindings('call') }))).toBe('call/call-k');
        const client = await server.connect('s-1');
        try {
          expect(text((await client.callTool('env_tool', {})) as CallToolResult)).toBe('no workerEnv');
        } finally {
          await client.close();
        }
      } finally {
        await server.dispose();
      }
    });
  });
});
