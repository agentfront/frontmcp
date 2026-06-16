/**
 * Functional factories — assemble a server with NO decorators using the public
 * `tool` / `resource` / `prompt` / `skill` / `app` factories (FUNCTION/VALUE
 * registry kinds). Also the regression guard for the newly-added `app()`
 * factory (apps previously had no functional form). Served end-to-end over the
 * web-fetch handler.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { FrontMcpInstance } from '../../../front-mcp/front-mcp';
import { type Scope } from '../../../scope/scope.instance';
import { createWebFetchHandler, type WebFetchHandler } from '../../../transport/web-fetch-handler';
import { app } from '../app.decorator';
import { prompt } from '../prompt.decorator';
import { resource } from '../resource.decorator';
import { skill } from '../skill.decorator';
import { tool } from '../tool.decorator';

const echoTool = tool({ name: 'echo', description: 'Echo', inputSchema: { message: z.string() } })((input: {
  message: string;
}) => ({ content: [{ type: 'text' as const, text: `Echo: ${input.message}` }] }));

const configResource = resource({ name: 'config', uri: 'config://app', description: 'App config', mimeType: 'application/json' })(
  (uri: string) => ({ contents: [{ uri, text: '{"k":"v"}' }] }),
);

const greetPrompt = prompt({ name: 'greet', description: 'Greet', arguments: [{ name: 'who', required: true }] })(
  (args: Record<string, string> | undefined) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hi ${args?.['who']}` } }],
  }),
);

const helperSkill = skill({
  name: 'helper',
  description: 'A helper skill',
  instructions: 'Use the echo tool to repeat input.',
  tools: [{ name: 'echo' }],
});

// The newly-added functional app factory — no `@App` decorator.
const allApp = app({
  id: 'factory-app',
  name: 'factory-app',
  tools: [echoTool],
  resources: [configResource],
  prompts: [greetPrompt],
  skills: [helperSkill],
});

const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('functional factories (decorator-free assembly via app())', () => {
  let instance: FrontMcpInstance;
  let handler: WebFetchHandler;

  beforeAll(async () => {
    instance = await FrontMcpInstance.createForGraph({ info: { name: 'factory-test', version: '1.0.0' }, apps: [allApp] });
    handler = createWebFetchHandler(instance.getScopes()[0] as Scope);
  });
  afterAll(async () => {
    await instance?.dispose?.();
  });

  const result = async (body: unknown): Promise<any> =>
    (await handler(new Request('https://w/mcp', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }))).json();

  it('app() boots a server with tool/resource/prompt/skill (initialize ok)', async () => {
    const json = await result({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1.0.0' } },
    });
    expect(json.result?.serverInfo?.name).toBe('factory-test');
  });

  it('tool: list + call', async () => {
    const list = await result({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect((list.result?.tools ?? []).map((t: { name: string }) => t.name)).toContain('echo');
    const call = await result({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { message: 'hi' } } });
    expect(call.result?.content?.[0]?.text).toBe('Echo: hi');
  });

  it('resource: list + read', async () => {
    const list = await result({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
    expect((list.result?.resources ?? []).map((r: { uri: string }) => r.uri)).toContain('config://app');
    const read = await result({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'config://app' } });
    expect(read.result?.contents?.[0]?.text).toBe('{"k":"v"}');
  });

  it('prompt: list + get', async () => {
    const list = await result({ jsonrpc: '2.0', id: 5, method: 'prompts/list', params: {} });
    expect((list.result?.prompts ?? []).map((p: { name: string }) => p.name)).toContain('greet');
    const get = await result({ jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'greet', arguments: { who: 'Ada' } } });
    expect(get.result?.messages?.[0]?.content?.text).toBe('Hi Ada');
  });
});
