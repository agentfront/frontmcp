/**
 * `this.idempotencyKey` is the `idempotencyKey` of the call context an in-process dispatcher runs `tools:call-tool`
 * with: nothing a client sends (arguments or `_meta`) sets it, and a context spread from a marked one does not carry a
 * key the dispatcher made non-enumerable.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@Tool({ name: 'read_key', inputSchema: {}, outputSchema: { key: z.string().nullable() } })
class ReadKeyTool extends ToolContext {
  async execute() {
    return { key: this.idempotencyKey ?? null };
  }
}

const dispatchInput = { key: z.string().optional(), meta: z.string().optional(), spread: z.boolean().optional() };

@Tool({ name: 'dispatch', inputSchema: dispatchInput })
class DispatchTool extends ToolContext {
  async execute({ key, meta, spread }: { key?: string; meta?: string; spread?: boolean }) {
    const marked = { authInfo: this.authInfo };
    if (key !== undefined) Object.defineProperty(marked, 'idempotencyKey', { value: key, enumerable: false });
    const result = await this.scope.runFlow('tools:call-tool', {
      request: {
        method: 'tools/call',
        params: { name: 'read_key', arguments: {}, ...(meta !== undefined && { _meta: { idempotencyKey: meta } }) },
      },
      ctx: spread ? { ...marked } : marked,
    });
    return result?.structuredContent ?? {};
  }
}

@Tool({ name: 'ask_key', inputSchema: {} })
class AskKeyTool extends ToolContext {
  async execute() {
    await this.elicit('Go on?', z.object({ go: z.boolean() }));
    return { key: this.idempotencyKey ?? null };
  }
}

@Tool({ name: 'dispatch_ask', inputSchema: { key: z.string() } })
class DispatchAskTool extends ToolContext {
  async execute({ key }: { key: string }) {
    const ctx = Object.defineProperty({ authInfo: this.authInfo }, 'idempotencyKey', { value: key });
    const asked = await this.scope.runFlow('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'ask_key', arguments: {} } },
      ctx,
    });
    const pending = (asked?._meta as { elicitationPending?: { elicitId: string } } | undefined)?.elicitationPending;
    return { elicitId: pending?.elicitId ?? null };
  }
}

@App({ id: 'keys', name: 'Keys', tools: [ReadKeyTool, DispatchTool, AskKeyTool, DispatchAskTool] })
class KeysApp {}

describe('this.idempotencyKey', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tool-idempotency-key', version: '1.0.0' },
      apps: [KeysApp],
      elicitation: { enabled: true },
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("is the key on the dispatcher's call context", async () => {
    const result = await server.callTool('dispatch', { key: 'run-1:0' });

    expect(result.structuredContent).toEqual({ key: 'run-1:0' });
  });

  it('is undefined for a client call, whatever its arguments say', async () => {
    const result = await server.callTool('read_key', { idempotencyKey: 'forged' });

    expect(result.structuredContent).toEqual({ key: null });
  });

  it('is not set by the request `_meta`', async () => {
    const result = await server.callTool('dispatch', { meta: 'forged' });

    expect(result.structuredContent).toEqual({ key: null });
  });

  it('is not carried by a context spread from one with a non-enumerable key', async () => {
    const result = await server.callTool('dispatch', { key: 'run-1:1', spread: true });

    expect(result.structuredContent).toEqual({ key: null });
  });

  it('is kept when the tool is run again for the answer of an elicitation fallback', async () => {
    const owner = { authContext: { user: { sub: 'nour' } } };
    const asked = await server.callTool('dispatch_ask', { key: 'run-1:3' }, owner);
    const { elicitId } = asked.structuredContent as { elicitId: string | null };
    expect(elicitId).toEqual(expect.any(String));

    const answered = await server.callTool(
      'sendElicitationResult',
      { elicitId, action: 'accept', content: { go: true } },
      owner,
    );

    expect(answered.structuredContent).toEqual({ key: 'run-1:3' });
  });
});
