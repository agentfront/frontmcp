import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { create, LogLevel, tool, type DirectMcpServer } from '@frontmcp/sdk';

import WebMcpPlugin from '../webmcp.plugin';
import { FakeModelContext, settle } from './helpers/fake-model-context';

const echo = tool({ name: 'echo', description: 'Echo', inputSchema: { text: z.string() }, outputSchema: 'string' })(
  async ({ text }: { text: string }) => text,
);
const echoObject = tool({ name: 'echo_object', description: 'Echo', inputSchema: { text: z.string() } })(
  async ({ text }: { text: string }) => ({ text }),
);
const chart = tool({ name: 'chart', description: 'A chart and its data', inputSchema: {} })(async () => ({
  content: [
    { type: 'text' as const, text: '{"points":[1,2]}' },
    { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' },
  ],
  structuredContent: { points: [1, 2] },
}));
const greet = tool({ name: 'greet', description: 'Greets', inputSchema: {} })(async () => 'hi');
const echoText = tool({ name: 'echo_text', description: 'Echo', inputSchema: { text: z.string() } })(
  async ({ text }: { text: string }) => ({ content: [{ type: 'text' as const, text }] }),
);

describe('what an agent receives from a call', () => {
  let modelContext: FakeModelContext;
  let server: DirectMcpServer;

  async function start(options: Parameters<typeof WebMcpPlugin.init>[0] = {}) {
    modelContext = new FakeModelContext();
    server = await create({
      info: { name: 'result', version: '1.0.0' },
      tools: [echo, echoObject, echoText, chart, greet],
      plugins: [WebMcpPlugin.init({ modelContext, ...options })],
      logging: { level: LogLevel.Off },
    });
    await settle();
  }

  afterEach(async () => {
    await server?.dispose();
  });

  it('is the structured content alone by default, when the tool has it', async () => {
    await start();

    expect(await modelContext.execute('echo_object', { text: 'hello' })).toEqual({ text: 'hello' });
    expect(await modelContext.execute('echo', { text: 'hello' })).toEqual({ content: 'hello' });
  });

  it('wraps a plain value the tool returns, as the server does', async () => {
    await start();

    expect(await modelContext.execute('greet')).toEqual({ value: 'hi' });
  });

  it('keeps every content part by default when the content is more than the text copy', async () => {
    await start();

    expect(await modelContext.execute('chart')).toEqual({
      content: [
        { type: 'text', text: '{"points":[1,2]}' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
      structuredContent: { points: [1, 2] },
    });
  });

  it('is the content by default, when the tool has no structured content', async () => {
    await start();

    expect(await modelContext.execute('echo_text', { text: 'hello' })).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it("is the content alone with result: 'content'", async () => {
    await start({ result: 'content' });

    expect(await modelContext.execute('echo_object', { text: 'hello' })).toEqual({
      content: [{ type: 'text', text: '{"text":"hello"}' }],
    });
  });

  it("is both, as an MCP client gets them, with result: 'both'", async () => {
    await start({ result: 'both' });

    expect(await modelContext.execute('echo_object', { text: 'hello' })).toEqual({
      content: [{ type: 'text', text: '{"text":"hello"}' }],
      structuredContent: { text: 'hello' },
    });
  });
});
