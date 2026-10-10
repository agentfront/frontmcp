/**
 * `this.workerEnv` everywhere the docs promise it (#678).
 *
 * The docs and the d.ts say a tool, resource, prompt or agent reads the Worker's bindings with
 * `this.workerEnv`. A tool did; a prompt had no such property, and a job run by `execute_job`
 * built its context without the request's, so both read `undefined` on a Worker. These drive a
 * real scope through the Web fetch handler a Worker uses, with an `env` holding a string and a
 * non-string binding.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult, GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';

import { Job, Prompt, Resource, Tool } from '../../common';
import { App } from '../../common/decorators/app.decorator';
import { JobContext, PromptContext, ResourceContext, ToolContext } from '../../common/interfaces';
import { LogLevel } from '../../common/types/options/logging';
import { clearCreateCache, create } from '../../direct/create';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createWebFetchHandler, type WebFetchHandler } from '../web-fetch-handler';

interface FakeKv {
  get(key: string): string | undefined;
}

/** What `workerEnv` shows: the string binding and whether the KV binding is the env's object. */
function describeEnv(env: Readonly<Record<string, unknown>> | undefined, kv: FakeKv): string {
  if (!env) return 'no workerEnv';
  return `${String(env['GREETING'])}/${env['MY_KV'] === kv ? 'kv' : 'no-kv'}`;
}

const kv: FakeKv = { get: (key) => `value-of-${key}` };
const env = { GREETING: 'hello', MY_KV: kv };

@Tool({ name: 'env_tool', inputSchema: {} })
class EnvTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: describeEnv(this.workerEnv, kv) }] };
  }
}

@Resource({ name: 'env_resource', uri: 'env://bindings', mimeType: 'text/plain' })
class EnvResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: describeEnv(this.workerEnv, kv) }] };
  }
}

@Prompt({ name: 'env_prompt', arguments: [] })
class EnvPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: describeEnv(this.workerEnv, kv) } }] };
  }
}

@Job({ name: 'env_job', inputSchema: {}, outputSchema: { env: z.string() } })
class EnvJob extends JobContext {
  async execute() {
    return { env: describeEnv(this.workerEnv, kv) };
  }
}

@App({
  id: 'worker-env',
  name: 'worker-env',
  tools: [EnvTool],
  resources: [EnvResource],
  prompts: [EnvPrompt],
  jobs: [EnvJob],
})
class WorkerEnvApp {}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

async function rpc<T>(handler: WebFetchHandler, method: string, params: unknown, workerEnv?: unknown): Promise<T> {
  const request = new Request('https://worker.example.com/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const res = await handler(request, undefined, workerEnv);
  const text = await res.text();
  const json = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? JSON.parse((text.split('\n').find((l) => l.startsWith('data:')) ?? 'data: {}').slice('data:'.length).trim())
    : JSON.parse(text);
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result as T;
}

describe('this.workerEnv on a Worker request (#678)', () => {
  let scope: Scope;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'worker-env', version: '1.0.0' },
      apps: [WorkerEnvApp],
      http: { entryPath: '/mcp' },
      jobs: { enabled: true },
      logging: { level: LogLevel.Off },
    });
    scope = instance.getScopes()[0] as Scope;
    handler = createWebFetchHandler(scope);
  });

  afterAll(async () => {
    await scope?.shutdown();
  });

  it('reaches a tool', async () => {
    const result = await rpc<CallToolResult>(handler, 'tools/call', { name: 'env_tool', arguments: {} }, env);

    expect(result.content[0]).toMatchObject({ text: 'hello/kv' });
  });

  it('reaches a resource', async () => {
    const result = await rpc<ReadResourceResult>(handler, 'resources/read', { uri: 'env://bindings' }, env);

    expect(result.contents[0]).toMatchObject({ text: 'hello/kv' });
  });

  it('reaches a prompt', async () => {
    const result = await rpc<GetPromptResult>(handler, 'prompts/get', { name: 'env_prompt', arguments: {} }, env);

    expect(result.messages[0].content).toMatchObject({ text: 'hello/kv' });
  });

  it('reaches a job run by execute_job', async () => {
    const result = await rpc<CallToolResult>(
      handler,
      'tools/call',
      { name: 'execute_job', arguments: { name: 'env_job', input: {} } },
      env,
    );

    expect(result.structuredContent).toMatchObject({ state: 'completed', result: { env: 'hello/kv' } });
  });

  it('is undefined where the request carries no bindings', async () => {
    const tool = await rpc<CallToolResult>(handler, 'tools/call', { name: 'env_tool', arguments: {} });
    const prompt = await rpc<GetPromptResult>(handler, 'prompts/get', { name: 'env_prompt', arguments: {} });

    expect(tool.content[0]).toMatchObject({ text: 'no workerEnv' });
    expect(prompt.messages[0].content).toMatchObject({ text: 'no workerEnv' });
  });

  it('does not copy string bindings into process.env: the generated Worker entry does that', async () => {
    delete process.env['GREETING'];

    await rpc<CallToolResult>(handler, 'tools/call', { name: 'env_tool', arguments: {} }, env);

    expect(process.env['GREETING']).toBeUndefined();
  });
});

describe('this.workerEnv on a direct server (#678)', () => {
  // #706 — a direct call passes bindings with `workerEnv` (see direct-server.worker-env.spec.ts)
  it('is undefined when the server and the call pass no workerEnv', async () => {
    const server = await create({
      info: { name: 'worker-env-direct', version: '1.0.0' },
      tools: [EnvTool],
      prompts: [EnvPrompt],
      logging: { level: LogLevel.Off },
    });
    try {
      const tool = await server.callTool('env_tool', {});
      const prompt = await server.getPrompt('env_prompt', {});

      expect(tool.content[0]).toMatchObject({ text: 'no workerEnv' });
      expect(prompt.messages[0].content).toMatchObject({ text: 'no workerEnv' });
    } finally {
      await server.dispose();
      clearCreateCache();
    }
  });
});
